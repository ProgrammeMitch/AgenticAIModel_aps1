const express = require('express');
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const { GEMINI_API_KEY } = require('../config.js');

let router = express.Router();

// Initialize the Gemini Client
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// NEW: The upgraded Hybrid Query tool
const searchBimElementsTool = {
    functionDeclarations: [{
        name: "search_bim_elements",
        description: "Searches the 3D model for elements based on specific constraints like category, level, and properties.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                base_category: {
                    type: SchemaType.STRING,
                    description: "The core element type requested (e.g., 'door', 'window', 'desk'). MUST be a singular noun."
                },
                level_constraint: {
                    type: SchemaType.STRING,
                    description: "The specific floor or level requested (e.g., 'Level 2', 'Third Floor'). Leave null or omit if the user didn't specify a level."
                },
                property_modifiers: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                    description: "Any descriptive adjectives or modifiers from the user's prompt (e.g., ['double', 'flush'], ['double-glazed', 'casement']). Omit if none."
                }
            },
            required: ["base_category"],
        },
    }],
};

// 1. Define your fallback hierarchy (using universal aliases)
const availableModels = [
    "gemini-1.5-flash",         
    "gemini-2.5-flash",         
    "gemini-pro"                
];

router.post('/api/agent/ask', async (req, res, next) => {
    const userMessage = req.body.prompt;
    let lastError = null;

    // 2. Loop through the models in order (The Load Balancer)
    for (let i = 0; i < availableModels.length; i++) {
        const currentModelName = availableModels[i];
        console.log(`\n🔄 [Load Balancer] Attempting request with: ${currentModelName}`);

        try {
            const model = genAI.getGenerativeModel({
                model: currentModelName,
                tools: [searchBimElementsTool], // <--- Updated tool here
            });

            // Send the prompt
            const result = await model.generateContent(userMessage);
            const response = result.response;
            const functionCalls = response.functionCalls();

            // 3. If successful, return immediately
            if (functionCalls && functionCalls.length > 0) {
                const call = functionCalls[0];
                return res.json({
                    actionRequired: true,
                    functionName: call.name,
                    arguments: call.args
                });
            } else {
                return res.json({ 
                    actionRequired: false, 
                    reply: response.text() 
                });
            }

        } catch (err) {
            console.warn(`⚠️ [Load Balancer] ${currentModelName} failed. Reason: ${err.message}`);
            lastError = err; 
        }
    }

    console.error("🚨 [Load Balancer] ALL models failed. Final error:", lastError.message);
    res.status(500).json({ 
        actionRequired: false, 
        reply: `Backend AI Error: All AI agents are currently at capacity. Please try again in a few moments.` 
    });
});

module.exports = router;