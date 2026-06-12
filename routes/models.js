const express = require('express');
const formidable = require('express-formidable');

// 1. We now import our new deleteObject function here
const { listObjects, uploadObject, translateObject, getManifest, urnify, deleteObject } = require('../services/aps.js');

let router = express.Router();

router.get('/api/models', async function (req, res, next) {
    try {
        const objects = await listObjects();
        res.json(objects.map(o => ({
            name: o.objectKey,
            urn: urnify(o.objectId)
        })));
    } catch (err) {
        next(err);
    }
});

router.get('/api/models/:urn/status', async function (req, res, next) {
    try {
        const manifest = await getManifest(req.params.urn);
        if (manifest) {
            let messages = [];
            if (manifest.derivatives) {
                for (const derivative of manifest.derivatives) {
                    messages = messages.concat(derivative.messages || []);
                    if (derivative.children) {
                        for (const child of derivative.children) {
                            messages.concat(child.messages || []);
                        }
                    }
                }
            }
            res.json({ status: manifest.status, progress: manifest.progress, messages });
        } else {
            res.json({ status: 'n/a' });
        }
    } catch (err) {
        next(err);
    }
});

router.post('/api/models', formidable({ maxFileSize: Infinity }), async function (req, res, next) {
    const file = req.files['model-file'];
    if (!file) {
        res.status(400).send('The required field ("model-file") is missing.');
        return;
    }
    try {
        const obj = await uploadObject(file.name, file.path);
        await translateObject(urnify(obj.objectId), req.fields['model-zip-entrypoint']);
        res.json({
            name: obj.objectKey,
            urn: urnify(obj.objectId)
        });
    } catch (err) {
        next(err);
    }
});

// 2. The perfectly integrated Kill Switch
router.delete('/api/models/:urn', async (req, res, next) => {
    try {
        const urn = req.params.urn;
        const decodedUrn = Buffer.from(urn, 'base64').toString('utf8');
        const objectKey = decodedUrn.split('/').pop(); 
        
        // Call the clean SDK wrapper function we just built
        await deleteObject(objectKey); 
        
        console.log(`🗑️ [Gatekeeper] Purged non-compliant model: ${objectKey}`);
        res.status(200).json({ success: true, message: "Model purged from bucket." });
    } catch (err) {
        console.error("🚨 Failed to delete model:", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;