🏗️ BIM-AI Interrogator
An autonomous, natural-language AI agent integrated directly with Autodesk Platform Services (APS). Built to demonstrate the intersection of Large Language Models and Hypergranular BIM.

This application allows users to upload Revit (.rvt) models, run strict ISO-style metadata compliance checks (The Gatekeeper), and use a conversational AI interface to instantly query, isolate, and count specific 3D elements based on deep property dictionary searches.

✨ Core Features
The Gatekeeper (Data Compliance): A rigorous pre-check protocol that halts interaction until the uploaded model passes structural data requirements (e.g., forcing valid Uniclass strings within Assembly Code or custom VIISP_Uniclass project parameters). Includes a cloud-purge "Kill Switch" for non-compliant models.

Natural Language Interrogation: Powered by Google's Gemini 2.5 Flash model, users can type everyday questions (e.g., "Show me all the fire-rated doors on Level 2") instead of writing complex database queries.

The "Smart Bracket Hunter" Algorithm: A custom two-pass recursive extraction script that prevents the AI from falling into the "Leaf Trap." It accurately filters out nested families (like window trims or door handles) to ensure the AI only isolates and counts true top-level Revit Instances.

Deep Property Scanning: Bypasses literal category searches by stringifying the entire APS property dictionary for each instance, allowing the AI to find specific materials, classifications, or dimensional data hidden deep within the model.

🛠️ Tech Stack
Backend: Node.js, Express.js

Cloud & 3D Viewing: Autodesk Platform Services (@aps_sdk/authentication, @aps_sdk/oss, @aps_sdk/model-derivative), Forge Viewer (v7)

AI Engine: Google Generative AI (@google/generative-ai)

Frontend: Vanilla JavaScript, HTML5, CSS3

🚀 Getting Started
Prerequisites
Node.js (v18+)

An Autodesk APS Developer Account and App Credentials.

A Google AI Studio API Key for Gemini.

Installation
Clone the repository:

Bash
git clone https://github.com/yourusername/bim-ai-interrogator.git
cd bim-ai-interrogator
Install the required dependencies:

Bash
npm install
Configure your Environment Variables. Create a .env file in the root directory and add your keys:

Code snippet
APS_CLIENT_ID="your_autodesk_client_id"
APS_CLIENT_SECRET="your_autodesk_client_secret"
APS_BUCKET="your_custom_bucket_name_lower_case"
GEMINI_API_KEY="your_google_gemini_key"
PORT=8080

Start the application:

Bash
node server.js
Open your browser and navigate to http://localhost:8080.

🎮 Usage Instructions
Upload: Use the UI to upload a .rvt or .ifc file. Wait for the APS Model Derivative service to translate it to SVF2.

Scan: Once loaded, click Run Compliance Scan. The Gatekeeper will verify that required categories (e.g., Doors, Windows) possess the necessary Uniclass/Assembly properties.

Interact: If the model passes, the AI Agent unlocks. Use the chat box to issue commands.

Note: Free-tier Gemini API keys are subject to a 15 Request-Per-Minute (RPM) limit. If you receive an error, wait 60 seconds for the quota to reset.

🧠 Architecture Notes for Developers
Routing: API logic is isolated in /routes/ (e.g., agent.js, models.js). Ensure express.json() is mounted in server.js before the agent route to properly parse frontend prompts.

Viewer Context: The frontend AI logic (viewer.js) executes the final visual isolation. It relies on the literal Revit Category parameter to map human terms ("doors") to hardcoded architectural families, ensuring accuracy regardless of model language.

📄 License
This project is licensed under the MIT License.

