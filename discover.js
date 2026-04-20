/**
 * AIcontrast — Auto-Discovery Script
 *
 * Finds new AI tools using OpenAI and inserts them into Supabase as pending_tools.
 * Run manually or via GitHub Actions cron (see .github/workflows/discover.yml).
 *
 * Required environment variables:
 *   SUPABASE_URL        — your Supabase project URL
 *   SUPABASE_SERVICE_KEY — service-role key (bypasses RLS)
 *   OPENAI_API_KEY      — OpenAI API key
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

/* ─────────────────────────────────────────────
   CONFIG
───────────────────────────────────────────── */
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY       = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !OPENAI_API_KEY) {
  console.error('❌ Missing environment variables. Set SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const openai   = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ─────────────────────────────────────────────
   STEP 1: Fetch existing tool names from DB
   (so we don't suggest duplicates)
───────────────────────────────────────────── */
async function getExistingNames() {
  const { data, error } = await supabase
    .from('tools')
    .select('name')
    .limit(500);
  if (error) {
    console.warn('Could not fetch existing tools:', error.message);
    return [];
  }
  return data.map(r => r.name.toLowerCase());
}

/* ─────────────────────────────────────────────
   STEP 2: Ask GPT-4 to discover new AI tools
───────────────────────────────────────────── */
async function discoverNewTools(existingNames) {
  const existingList = existingNames.join(', ');

  const systemPrompt = `You are an expert curator of AI tools and products.
Your job is to discover NEW and notable AI tools that are genuinely useful and have real users.
You must return valid JSON only — no markdown, no explanation.`;

  const userPrompt = `Find 10 NEW AI tools that are NOT already in this list: ${existingList}

Focus on tools launched or significantly updated in the last 6 months.
Include tools from all categories: chatbots, image generation, video, audio, code, writing, productivity, search, data, business.

Return a JSON array of exactly 10 tool objects with this exact structure:
[
  {
    "name": "Tool Name",
    "emoji": "🤖",
    "category": "one of: Chatbots & LLMs | Image & Art | Code & Dev | Writing & Content | Productivity | Video & Audio | Search & Research | Data & Analytics | Business & Marketing",
    "tags": ["tag1", "tag2"],
    "badge": "new" or "top" or "popular" or "free" or null,
    "short_desc": "One compelling sentence description under 120 characters",
    "long_desc": "2-3 sentence detailed description for a modal view",
    "rating": 4.3,
    "reviews": 5000,
    "year": 2024,
    "popularity": 50000,
    "website": "https://example.com",
    "domain": "example.com",
    "pros": ["Pro 1", "Pro 2", "Pro 3"],
    "cons": ["Con 1", "Con 2"],
    "breakdown": {"Quality": 4.3, "Speed": 4.5, "Value": 4.4, "UX": 4.2}
  }
]

Rules:
- Only include real, live products with real websites
- rating must be between 3.5 and 5.0
- year must be between 2018 and 2025
- Do not include tools from the existing list
- Return ONLY the JSON array, no other text`;

  console.log('🤖 Asking GPT-4 to discover new tools…');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0].message.content;

  // GPT returns json_object — extract the array
  let parsed;
  try {
    parsed = JSON.parse(raw);
    // Handle both { tools: [...] } and direct array
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.tools)) return parsed.tools;
    // Find the first array value
    const arr = Object.values(parsed).find(v => Array.isArray(v));
    if (arr) return arr;
    throw new Error('No array found in response');
  } catch (e) {
    console.error('Failed to parse GPT response:', e.message);
    console.error('Raw response:', raw.slice(0, 500));
    return [];
  }
}

/* ─────────────────────────────────────────────
   STEP 3: Filter out duplicates and validate
───────────────────────────────────────────── */
function validateTool(tool, existingNames) {
  if (!tool.name || !tool.category || !tool.website) return false;
  if (existingNames.includes(tool.name.toLowerCase())) return false;
  if (tool.rating < 1 || tool.rating > 5) return false;
  if (!tool.short_desc || tool.short_desc.length < 10) return false;
  return true;
}

/* ─────────────────────────────────────────────
   STEP 4: Insert pending tools into Supabase
───────────────────────────────────────────── */
async function insertPendingTools(tools) {
  const rows = tools.map(t => ({
    data:   t,
    source: 'gpt-4o',
  }));

  const { data, error } = await supabase
    .from('pending_tools')
    .insert(rows);

  if (error) {
    console.error('❌ Failed to insert pending tools:', error.message);
    return 0;
  }
  return rows.length;
}

/* ─────────────────────────────────────────────
   STEP 5: (Optional) Post summary to a webhook
───────────────────────────────────────────── */
async function notifyWebhook(count) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const message = count > 0
    ? `🤖 AIcontrast Discovery: Found **${count} new AI tools** awaiting review in the admin panel.`
    : '🤖 AIcontrast Discovery: No new tools found this run.';

  try {
    const body = webhookUrl.includes('slack')
      ? JSON.stringify({ text: message })
      : JSON.stringify({ content: message });

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    console.log('📨 Webhook notification sent');
  } catch (e) {
    console.warn('Could not send webhook:', e.message);
  }
}

/* ─────────────────────────────────────────────
   MAIN
───────────────────────────────────────────── */
async function main() {
  console.log('🚀 AIcontrast Auto-Discovery starting…');
  console.log('📅 Date:', new Date().toISOString());

  try {
    // 1. Get existing tool names
    const existing = await getExistingNames();
    console.log(`📊 Found ${existing.length} existing tools in DB`);

    // 2. Discover new tools
    const discovered = await discoverNewTools(existing);
    console.log(`🔍 GPT discovered ${discovered.length} candidate tools`);

    // 3. Validate
    const valid = discovered.filter(t => validateTool(t, existing));
    console.log(`✅ ${valid.length} tools passed validation`);

    if (!valid.length) {
      console.log('ℹ️  No new tools to add this run.');
      await notifyWebhook(0);
      return;
    }

    // Log each tool found
    valid.forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.name} (${t.category}) — ${t.website}`);
    });

    // 4. Insert into pending_tools
    const inserted = await insertPendingTools(valid);
    console.log(`💾 Inserted ${inserted} tools into pending_tools table`);
    console.log('👉 Go to admin.html → Pending Approval to review and publish them');

    // 5. Notify
    await notifyWebhook(inserted);

    console.log('✨ Discovery complete!');
  } catch (err) {
    console.error('💥 Discovery failed:', err);
    process.exit(1);
  }
}

main();
