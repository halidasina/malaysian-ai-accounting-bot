require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function testModel(modelName) {
  try {
    const response = await anthropic.messages.create({
      model: modelName,
      max_tokens: 10,
      messages: [{ role: "user", content: "Hi" }]
    });
    console.log(`✅ Success with model: ${modelName}`);
    return true;
  } catch (error) {
    console.log(`❌ Failed with model: ${modelName} - ${error.message}`);
    return false;
  }
}

async function runTests() {
  const models = [
    "claude-3-7-sonnet-20250219",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-3-haiku-20240307",
    "claude-2.1"
  ];
  
  for (const model of models) {
    console.log(`Testing ${model}...`);
    const success = await testModel(model);
    if (success) break;
  }
}

runTests();
