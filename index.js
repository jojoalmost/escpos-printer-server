// printer-server.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const escpos = require('escpos');
// Initialize USB adapter
escpos.USB = require('escpos-usb');

// Patch the USB write method to handle missing endpoint
const originalUSB = escpos.USB;
class PatchedUSB extends originalUSB {
    write(data, callback) {
        if (!this.endpoint) {
            console.error('USB endpoint is not initialized');
            if (typeof callback === 'function') {
                callback(new Error('USB endpoint is not initialized'));
            }
            return;
        }

        try {
            this.endpoint.transfer(data, callback);
        } catch (error) {
            console.error('USB transfer error:', error);
            if (typeof callback === 'function') {
                callback(error);
            }
        }
    }
}
escpos.USB = PatchedUSB;

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for your Next.js application domain
app.use(cors({
    origin: ['http://localhost:3000', 'https://your-nextjs-app.vercel.app'],
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(bodyParser.json());

// Get available printers
app.get('/api/printers', (req, res) => {
    try {
        const devices = escpos.USB.findPrinter();
        if (devices.length === 0) {
            return res.json({ success: true, printers: [], message: 'No USB printers found' });
        }

        const printers = devices.map((device, index) => ({
            id: index,
            vendorId: device.deviceDescriptor.idVendor,
            productId: device.deviceDescriptor.idProduct,
        }));

        res.json({ success: true, printers });
    } catch (error) {
        console.error('Error finding printers:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Print a receipt
app.post('/api/print', async (req, res) => {
    let device = null;

    try {
        const { content, printerId } = req.body;

        if (!content) {
            return res.status(400).json({ success: false, error: 'No content provided' });
        }

        const devices = escpos.USB.findPrinter();
        if (devices.length === 0) {
            return res.status(404).json({ success: false, error: 'No USB printers found' });
        }

        const selectedDevice = printerId !== undefined ? devices[printerId] : devices[0];

        if (!selectedDevice) {
            return res.status(404).json({ success: false, error: 'Selected printer not found' });
        }

        // Create printer instance with error handling
        device = new escpos.USB(
            selectedDevice.deviceDescriptor.idVendor,
            selectedDevice.deviceDescriptor.idProduct
        );

        // Add error event handler
        device.on('error', (error) => {
            console.error('USB device error:', error);
        });

        return new Promise((resolve, reject) => {
            // Process the print job with timeout and error handling
            const timeoutId = setTimeout(() => {
                reject(new Error('Print operation timed out'));
            }, 10000); // 10 second timeout

            try {
                device.open(function(error) {
                    if (error) {
                        clearTimeout(timeoutId);
                        return reject(new Error(`Failed to open USB device: ${error.message}`));
                    }

                    const printer = new escpos.Printer(device);

                    printer
                        .font('a')
                        .align('ct')
                        .style('b')
                        .size(1, 1)
                        .text(content.header || 'Receipt')
                        .text('------------------------')
                        .align('ct')
                        .style('normal')
                        .text('\n')
                    ;


                    if (content.body) {
                        if (content.body.header) {
                            printer.text(content.body.header);
                        }
                        if (content.body.main) {
                            printer.text(content.body.main);
                        }
                        if (content.body.footer) {
                            printer.text(content.body.footer);
                        }
                    }

                    // Print footer
                    if (content.footer) {
                        printer
                            .text('\n')
                            .text('------------------------')
                            .align('ct')
                            .text(content.footer);
                    }

                    try {
                        printer
                            .cut()
                            .close(() => {
                                clearTimeout(timeoutId);
                                resolve();
                            });
                    } catch (closeError) {
                        clearTimeout(timeoutId);
                        reject(new Error(`Error closing printer: ${closeError.message}`));
                    }
                });
            } catch (openError) {
                clearTimeout(timeoutId);
                reject(new Error(`Error opening device: ${openError.message}`));
            }
        })
            .then(() => {
                res.json({ success: true, message: 'Print job sent successfully' });
            })
            .catch((error) => {
                console.error('Print operation error:', error);
                res.status(500).json({ success: false, error: error.message });
            });

    } catch (error) {
        console.error('Error printing:', error);
        // Attempt to close the device if it exists and failed
        if (device) {
            try {
                device.close();
            } catch (closeError) {
                console.error('Error closing device after failure:', closeError);
            }
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'ESC/POS printer server is running' });
});

app.listen(PORT, () => {
    console.log(`ESC/POS Printer Server is running on port ${PORT}`);
});
