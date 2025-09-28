const axios = require("axios");
require("dotenv").config();

(async () => {
    try {
        const res = await axios.post("https://integrate.api.nvidia.com/v1/chat/completions", {
            model: "meta/llama-3.1-8b-instruct",  // ✅ valid model ID
            messages: [
                { role: "system", content: "You are a helpful translator." },
                { role: "user", content: "Say hello in Spanish." }
            ],
            max_tokens: 50
        }, {
            headers: {
                Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
                "Content-Type": "application/json"
            },
            timeout: 15000
        });

        console.log("✅ Response:", res.data.choices[0].message.content.trim());
    } catch (err) {
        console.error("❌ Error:", err.response?.data || err.message);
    }
})();
