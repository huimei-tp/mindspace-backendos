// nvidiaService.js
const axios = require('axios');
require('dotenv').config();

class NVIDIAService {
constructor() {
this.apiKey = process.env.NVIDIA_API_KEY;
this.baseURL = process.env.NVIDIA_BASE_URL || '[https://integrate.api.nvidia.com/v1](https://integrate.api.nvidia.com/v1)';
this.isEnabled = process.env.ENABLE_AI_CHAT === 'true';


    // Configure models (adjust IDs if NVIDIA updates them)
    this.models = {
        moderation: 'nvidia/llama-3.1-nemoguard-8b-content-safety',
        translation: 'meta/llama-3.1-8b-instruct',
        eventRecommendation: 'nvidia/llama-3.1-nemotron-70b-instruct',
        calendarAnalysis: 'meta/llama-3.1-8b-instruct'
    };

    // Validate at startup
    this.validateModels();
}

// ===============================
// MODEL VALIDATION (Smoke Test)
// ===============================

async validateModels() {
    if (!this.isEnabled || !this.apiKey) {
        console.warn('⚠️ NVIDIAService disabled, skipping model validation.');
        return;
    }

    for (const [key, modelId] of Object.entries(this.models)) {
        try {
            const res = await axios.post(`${this.baseURL}/chat/completions`, {
                model: modelId,
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 5
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 8000
            });

            if (res.data && res.data.choices) {
                console.log(`✅ Model works for ${key}: ${modelId}`);
            } else {
                console.warn(`⚠️ Model returned unexpected response for ${key}: ${modelId}`);
            }
        } catch (err) {
            if (err.response) {
                console.warn(`❌ Model failed for ${key}: ${modelId} [${err.response.status}]`, err.response.data);
            } else {
                console.warn(`❌ Model failed for ${key}: ${modelId}`, err.message);
            }
        }
    }
}

// ===============================
// FORUM CONTENT MODERATION
// ===============================

async moderateForumContent(content, contentType = 'post') {
    if (!this.isEnabled || !this.apiKey) {
        return this.getFallbackModerationResult();
    }

    try {
        const response = await axios.post(`${this.baseURL}/chat/completions`, {
            model: this.models.moderation,
            messages: [
                {
                    role: 'system',
                    content: `You are a content moderator for a caregiver support forum for families with children with intellectual disabilities. 


Analyze the following ${contentType} for:

1. Harmful content (abuse, threats, harassment)
2. Inappropriate language (profanity, offensive terms)
3. Medical misinformation
4. Spam or promotional content
5. Off-topic content

Respond with a JSON object containing:

* "safe": true/false
* "flagged_categories": array of issues found
* "severity": "low", "medium", "high"
* "reason": brief explanation
* "suggested_action": "approve", "review", "reject"

Content to analyze:`                    },
                    { role: 'user', content }
                ],
                temperature: 0.1,
                max_tokens: 300
            }, {
                headers: {
                    'Authorization':`Bearer ${this.apiKey}`,
'Content-Type': 'application/json'
},
timeout: 15000
});


        const result = this.parseModerationResponse(response.data.choices[0].message.content);
        return { success: true, ...result, model: this.models.moderation };

    } catch (error) {
        this.handleApiError(error, 'Moderation');
        return this.getFallbackModerationResult();
    }
}

// ===============================
// TRANSLATION
// ===============================

async translateForumPost(content, targetLanguage, sourceLanguage = 'auto') {
    if (!this.isEnabled || !this.apiKey) {
        return this.getFallbackTranslation(content, targetLanguage);
    }

    try {
        const response = await axios.post(`${this.baseURL}/chat/completions`, {
            model: this.models.translation,
            messages: [
                {
                    role: 'system',
                    content: `You are a professional translator specializing in caregiver and disability support content. 


Translate the following text to ${targetLanguage}:

* Maintain the original tone and context
* Use appropriate terminology for disability and caregiving
* Preserve any medical or technical terms accuracy
* If the text contains sensitive content, translate with empathy

Respond with only the translated text, no additional commentary.`                    },
                    { role: 'user', content }
                ],
                temperature: 0.3,
                max_tokens: 1000
            }, {
                headers: {
                    'Authorization':`Bearer ${this.apiKey}`,
'Content-Type': 'application/json'
},
timeout: 20000
});


        const translatedText = response.data.choices[0].message.content.trim();
        return {
            success: true,
            originalText: content,
            translatedText,
            sourceLanguage,
            targetLanguage,
            model: this.models.translation
        };

    } catch (error) {
        this.handleApiError(error, 'Translation');
        return this.getFallbackTranslation(content, targetLanguage);
    }
}

// ===============================
// EVENT RECOMMENDATIONS
// ===============================

async recommendEvents(childProfile, availableEvents, preferences = {}) {
    if (!this.isEnabled || !this.apiKey) {
        return this.getFallbackEventRecommendations(availableEvents);
    }

    try {
        const response = await axios.post(`${this.baseURL}/chat/completions`, {
            model: this.models.eventRecommendation,
            messages: [
                {
                    role: 'system',
                    content: `You are an expert in recommending activities and events for children with intellectual disabilities.


Analyze the child profile and recommend the most suitable events from the available options.

Consider:

* Child's age, interests, and abilities
* Specific needs and accommodations
* Parent preferences and constraints
* Event accessibility and appropriateness
* Potential benefits for the child's development

Respond with a JSON array of recommended events, each containing:

* "event_id": the event ID
* "match_score": 0-100 (how well it matches)
* "reasons": array of reasons why it's recommended
* "considerations": any important notes for the parent
* "expected_benefits": potential positive outcomes

Limit to top 5 recommendations, ordered by match score.`                    },
                    {
                        role: 'user',
                        content:`Child Profile: ${JSON.stringify(childProfile)}

Available Events: ${JSON.stringify(availableEvents)}

Parent Preferences: ${JSON.stringify(preferences)}`                    }
                ],
                temperature: 0.4,
                max_tokens: 1500
            }, {
                headers: {
                    'Authorization':`Bearer ${this.apiKey}`,
'Content-Type': 'application/json'
},
timeout: 25000
});


        const recommendations = this.parseEventRecommendations(response.data.choices[0].message.content);
        return { success: true, recommendations, childId: childProfile.id, model: this.models.eventRecommendation };

    } catch (error) {
        this.handleApiError(error, 'Event Recommendation');
        return this.getFallbackEventRecommendations(availableEvents);
    }
}

// ===============================
// CALENDAR ANALYSIS
// ===============================

async analyzeCalendarAndRecommendBreaks(calendarEvents, currentTime = new Date()) {
    if (!this.isEnabled || !this.apiKey) {
        return this.getFallbackBreakRecommendations();
    }

    try {
        const response = await axios.post(`${this.baseURL}/chat/completions`, {
            model: this.models.calendarAnalysis,
            messages: [
                {
                    role: 'system',
                    content: `You are a wellness coach specialized in caregiver mental health and stress management.


Analyze the user's calendar and recommend 5-minute micro-breaks based on:

* Gaps between appointments
* High-stress periods (back-to-back meetings)
* Meal times and natural break points
* Optimal timing for mental health
* Caregiver-specific stress patterns

Respond with a JSON object containing:

* "recommended_breaks": array of break suggestions
* "stress_analysis": assessment of calendar stress level (1-10)
* "optimal_times": best times for breaks today
* "warnings": any concerning patterns

Each break should include:

* "time": recommended time
* "duration": 5 minutes
* "activity": specific activity suggestion
* "reason": why this break is needed
* "type": "breathing", "movement", "mindfulness", "hydration", etc.`                  },
                    {
                        role: 'user',
                        content:`Current Time: ${currentTime.toISOString()}

Today's Calendar: ${JSON.stringify(calendarEvents)}`                    }
                ],
                temperature: 0.5,
                max_tokens: 1000
            }, {
                headers: {
                    'Authorization':`Bearer ${this.apiKey}`,
'Content-Type': 'application/json'
},
timeout: 20000
});


        const analysis = this.parseCalendarAnalysis(response.data.choices[0].message.content);
        return { success: true, ...analysis, timestamp: currentTime, model: this.models.calendarAnalysis };

    } catch (error) {
        this.handleApiError(error, 'Calendar Analysis');
        return this.getFallbackBreakRecommendations();
    }
}

// ===============================
// ERROR HANDLER
// ===============================

handleApiError(error, context) {
    if (error.response) {
        const { status, data } = error.response;
        if (status === 401) {
            console.error(`❌ [${context}] Unauthorized: Invalid API key or no access to model`);
        } else {
            console.error(`❌ [${context}] API error [${status}]:`, data);
        }
    } else {
        console.error(`❌ [${context}] Network/Config error:`, error.message);
    }
}

// ===============================
// RESPONSE PARSERS
// ===============================

parseModerationResponse(responseText) {
    try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (e) {
        console.error('Failed to parse moderation response:', e);
    }
    return { safe: true, flagged_categories: [], severity: 'low', reason: 'Unable to parse', suggested_action: 'review' };
}

parseEventRecommendations(responseText) {
    try {
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (e) {
        console.error('Failed to parse event recommendations:', e);
    }
    return [];
}

parseCalendarAnalysis(responseText) {
    try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (e) {
        console.error('Failed to parse calendar analysis:', e);
    }
    return { recommended_breaks: [], stress_analysis: 5, optimal_times: [], warnings: [] };
}

// ===============================
// FALLBACK RESPONSES
// ===============================

getFallbackModerationResult() {
    return { success: false, safe: true, flagged_categories: [], severity: 'low', reason: 'Moderation unavailable', suggested_action: 'review', model: 'fallback' };
}

getFallbackTranslation(content, targetLanguage) {
    return { success: false, originalText: content, translatedText: `[Translation to ${targetLanguage} unavailable - showing original text]`, sourceLanguage: 'unknown', targetLanguage, model: 'fallback' };
}

getFallbackEventRecommendations(availableEvents) {
    const recommendations = availableEvents.slice(0, 3).map((event, i) => ({
        event_id: event.id,
        match_score: 70 - (i * 10),
        reasons: ['Event appears generally suitable'],
        considerations: ['Please review event details manually'],
        expected_benefits: ['Social interaction', 'New experiences']
    }));
    return { success: false, recommendations, model: 'fallback' };
}

getFallbackBreakRecommendations() {
    const now = new Date();
    const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
    return {
        success: false,
        recommended_breaks: [{
            time: nextHour.toISOString(),
            duration: 5,
            activity: 'Take 5 deep breaths and stretch your shoulders',
            reason: 'Regular breaks help prevent caregiver burnout',
            type: 'breathing'
        }],
        stress_analysis: 5,
        optimal_times: [nextHour.toISOString()],
        warnings: ['AI analysis unavailable - monitor your stress manually'],
        model: 'fallback'
    };
}

// ===============================
// HEALTH CHECK (Smoke Test)
// ===============================

async healthCheck() {
    if (!this.isEnabled || !this.apiKey) {
        return { status: 'disabled', message: 'NVIDIA service is disabled or not configured' };
    }

    const results = {};
    for (const [key, modelId] of Object.entries(this.models)) {
        try {
            await axios.post(`${this.baseURL}/chat/completions`, {
                model: modelId,
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 5
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 8000
            });

            results[key] = { model: modelId, status: 'ok' };
        } catch (err) {
            results[key] = { model: modelId, status: 'error', error: err.response ? err.response.status : err.message };
        }
    }

    return { status: 'healthy', models: results, api_accessible: true };
}


}

const nvidiaService = new NVIDIAService();
module.exports = { nvidiaService };
