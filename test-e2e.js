import fs from 'fs';
import path from 'path';

async function testE2E() {
  console.log("🚀 Starting E2E test...");
  
  const imagePath = path.join(process.cwd(), 'input', 'sample', 'comic.png');
  if (!fs.existsSync(imagePath)) {
    console.error("❌ Test image not found at: " + imagePath);
    process.exit(1);
  }

  // 1. Upload
  console.log("📤 Uploading image...");
  const formData = new FormData();
  const blob = new Blob([fs.readFileSync(imagePath)]);
  formData.append('image', blob, 'comic.png');

  const uploadRes = await fetch('http://localhost:3001/api/upload', {
    method: 'POST',
    body: formData,
  });
  
  if (!uploadRes.ok) throw new Error(await uploadRes.text());
  const { sessionId } = await uploadRes.json();
  console.log(`✅ Uploaded. Session ID: ${sessionId}`);

  // 2. Analyze
  console.log("🔍 Analyzing with Gemini Vision OCR...");
  const analyzeRes = await fetch(`http://localhost:3001/api/analyze/${sessionId}`, {
    method: 'POST',
  });
  if (!analyzeRes.ok) throw new Error(await analyzeRes.text());
  const { metadata } = await analyzeRes.json();
  console.log("✅ Analysis complete:", metadata.title);

  // 3. Generate
  console.log("🎬 Generating voice, slicing, and rendering video...");
  const generateRes = await fetch(`http://localhost:3001/api/generate/${sessionId}`, {
    method: 'POST',
  });
  if (!generateRes.ok) throw new Error(await generateRes.text());
  const { videoPath } = await generateRes.json();
  console.log(`✅ Generation complete! Video saved to: ${videoPath}`);
}

testE2E().catch(console.error);
