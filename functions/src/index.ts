/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import * as functions from "firebase-functions/v1";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import Stripe from "stripe";
import { GoogleGenerativeAI } from "@google/generative-ai";
// Note: GoogleAuth and @google-cloud/vertexai are still installed for future use but not imported here

admin.initializeApp();

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: For v1 API, each function should use
// functions.runWith({ maxInstances: 10 }) instead of setGlobalOptions.
// In the v1 API, each function can only serve one request per container,
// so this will be the maximum concurrent request count.

// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

// Stripe configuration - uses environment variables only (no functions.config())
// These are set via Firebase secrets or .env files
const getStripeSecret = () => process.env.STRIPE_SECRET_KEY;
const getWebhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET;

// Lazy initialization of Stripe to avoid module-level config access
let stripeInstance: Stripe | undefined;
const getStripe = (): Stripe | undefined => {
  if (!stripeInstance) {
    const secret = getStripeSecret();
    if (secret) {
      stripeInstance = new Stripe(secret);
    }
  }
  return stripeInstance;
};

type PlanType = "plus" | "team";

const planCatalog: Record<PlanType, { amount: number; name: string; description: string }> = {
  plus: {
    amount: 1999,
    name: "RocketPrompt Plus",
    description: "Lifetime access to RocketPrompt Plus"
  },
  team: {
    amount: 9999,
    name: "RocketPrompt Pro (Team)",
    description: "One year of Team/Pro access"
  }
};

const allowedReturnOrigins = new Set([
  "http://localhost:4200",
  "http://127.0.0.1:4200",
  "https://rocketprompt.io",
  "https://www.rocketprompt.io",
  "https://rocket-prompt.web.app",
  "https://rocket-prompt.firebaseapp.com",
  "https://rocketprompt.web.app",
  "https://rocketprompt.firebaseapp.com"
]);

const resolveReturnUrl = (rawUrl: unknown, fallbackOrigin?: string): string => {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing return URL."
    );
  }

  try {
    const originToUse =
      fallbackOrigin && allowedReturnOrigins.has(fallbackOrigin) ?
        fallbackOrigin :
        undefined;
    const parsed = new URL(rawUrl, originToUse);
    const origin = `${parsed.protocol}//${parsed.host}`;
    if (!allowedReturnOrigins.has(origin)) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Return URL is not allowed."
      );
    }

    return parsed.toString();
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Invalid return URL."
    );
  }
};

const getRequestOrigin = (context: functions.https.CallableContext): string | undefined => {
  const raw = context.rawRequest as { headers?: Record<string, unknown> } | undefined;
  const originHeader = raw?.headers?.origin;
  return typeof originHeader === "string" ? originHeader : undefined;
};

export const createCheckoutSession = functions
  .region("us-central1")
  .runWith({ secrets: ["STRIPE_SECRET_KEY"] })
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "You must be signed in to start checkout."
      );
    }

    const stripe = getStripe();
    if (!stripe) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Stripe is not configured."
      );
    }

    const planKey = typeof data?.plan === "string" ?
      data.plan.toLowerCase() as PlanType :
      undefined;
    const plan = planKey ? planCatalog[planKey] : undefined;

    if (!planKey || !plan) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Unsupported plan requested."
      );
    }

    const requestOrigin = getRequestOrigin(context);
    const successUrl = resolveReturnUrl(data?.successUrl, requestOrigin);
    const cancelUrl = resolveReturnUrl(data?.cancelUrl, requestOrigin);

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: plan.name,
                description: plan.description
              },
              unit_amount: plan.amount
            },
            quantity: 1
          }
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          userId: context.auth.uid,
          planType: planKey
        },
        customer_email: typeof context.auth.token.email === "string" ?
          context.auth.token.email :
          undefined
      });

      return { sessionId: session.id, sessionUrl: session.url ?? null };
    } catch (error) {
      functions.logger.error("Failed to create Stripe checkout session", error);
      throw new functions.https.HttpsError(
        "internal",
        "Unable to create checkout session."
      );
    }
  });

/**
 * Updates the user's subscription status after Stripe confirms payment.
 *
 * The Checkout Session must include metadata entries for:
 *   - userId: Firebase Auth UID to update in Firestore
 *   - planType: "plus" | "team"
 */
export const stripeWebhook = functions
  .region("us-central1")
  .runWith({ secrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] })
  .https.onRequest(async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const stripe = getStripe();
    const webhookSecret = getWebhookSecret();
    if (!stripe || !webhookSecret) {
      functions.logger.error("Stripe secrets are not configured.");
      res.status(500).send("Stripe configuration missing.");
      return;
    }

    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).send("Missing Stripe signature.");
      return;
    }

    let event: Stripe.Event;
    try {
      // Firebase Functions v1 adds rawBody to the request object
      const rawBody =
        (req as { rawBody?: Buffer | string }).rawBody || req.body;
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature as string,
        webhookSecret
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown verification error";
      functions.logger.warn("Stripe signature verification failed", message);
      res.status(400).send(`Webhook Error: ${message}`);
      return;
    }

    if (event.type !== "checkout.session.completed") {
      res.sendStatus(200);
      return;
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    const planType = (session.metadata?.planType || "").toLowerCase();

    if (!userId || (planType !== "plus" && planType !== "team")) {
      functions.logger.error("Missing metadata", { userId, planType });
      res.status(400).send("Missing metadata.");
      return;
    }

    const paidAtMillis =
      (session.created || Math.floor(Date.now() / 1000)) * 1000;
    const paidAt = admin.firestore.Timestamp.fromMillis(paidAtMillis);

    const expiresAt =
      planType === "team" ?
        admin.firestore.Timestamp.fromMillis(
          paidAtMillis + 365 * 24 * 60 * 60 * 1000
        ) :
        null;

    const updates: Record<string, unknown> = {
      subscriptionStatus: planType === "team" ? "pro" : "plus",
      subscriptionPaidAt: paidAt,
    };

    if (expiresAt) {
      updates.subscriptionExpiresAt = expiresAt;
    } else {
      updates.subscriptionExpiresAt = admin.firestore.FieldValue.delete();
    }

    try {
      await admin.firestore().collection("users").doc(userId).set(
        updates,
        { merge: true }
      );
      functions.logger.info("Updated subscription", { userId, planType });
      res.sendStatus(200);
    } catch (error) {
      functions.logger.error("Failed to update user subscription", error);
      res.status(500).send("Failed to update subscription.");
    }
  });

// Image generation model - using Google's Generative AI SDK with Gemini 3 Pro Image
const IMAGE_GENERATION_MODEL = "gemini-3-pro-image-preview";

interface GeminiImagePayload {
  data: string;
  mimeType: string;
}

interface BulkPromptInput {
  title: string;
  content: string;
  tag: string;
  customUrl?: string;
  views?: number;
  likes?: number;
  launchGpt?: number;
  launchGemini?: number;
  launchClaude?: number;
  copied?: number;
  isInvisible?: boolean;
}

interface BulkUploadResult {
  promptId: string;
  title: string;
  imageUrl?: string;
  error?: string;
}

/**
 * Sleep utility for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateGeminiImagePayload(
  prompt: string,
  context: Record<string, unknown>,
  retryCount: number = 0
): Promise<GeminiImagePayload | null> {
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 3000;

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    functions.logger.error("Gemini API key not configured for image generation", context);
    return null;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: IMAGE_GENERATION_MODEL,
      generationConfig: {
        // @ts-expect-error - responseModalities is a valid config for image generation models
        responseModalities: ["image", "text"],
      },
    });

    const result = await model.generateContent(prompt);
    const response = result.response;
    let imageData: string | null = null;
    let mimeType = "image/png";

    const candidates = response.candidates;
    if (candidates && candidates.length > 0) {
      const parts = candidates[0].content?.parts;
      if (parts) {
        for (const part of parts) {
          if (part.inlineData?.data) {
            imageData = part.inlineData.data;
            mimeType = part.inlineData.mimeType || "image/png";
            break;
          }
        }
      }
    }

    if (!imageData) {
      functions.logger.warn("No image data returned from Gemini 3 Pro Image", {
        ...context,
        hasResponse: !!response,
        candidateCount: candidates?.length || 0,
      });
      return null;
    }

    return {
      data: imageData,
      mimeType,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if ((errorMessage.includes("429") || errorMessage.includes("RESOURCE_EXHAUSTED") || errorMessage.includes("quota")) && retryCount < MAX_RETRIES) {
      const delayMs = BASE_DELAY_MS * Math.pow(2, retryCount);
      functions.logger.warn("Rate limited while generating Gemini image", {
        ...context,
        retryAttempt: retryCount + 1,
        delayMs,
      });
      await sleep(delayMs);
      return generateGeminiImagePayload(prompt, context, retryCount + 1);
    }

    functions.logger.error("Failed to generate Gemini image", {
      ...context,
      error: errorMessage,
    });
    return null;
  }
}

async function saveGeneratedImageToStorage(
  image: GeminiImagePayload,
  buildFileName: (extension: string) => string,
  metadata: Record<string, string>,
  context: Record<string, unknown>
): Promise<string | null> {
  try {
    const bucket = admin.storage().bucket();
    const fileExtension = image.mimeType.split("/")[1] || "png";
    const fileName = buildFileName(fileExtension);
    const file = bucket.file(fileName);
    const imageBuffer = Buffer.from(image.data, "base64");

    const storageMetadata: Record<string, string> = {
      model: IMAGE_GENERATION_MODEL,
      generatedAt: new Date().toISOString(),
    };

    for (const [key, value] of Object.entries(metadata)) {
      storageMetadata[key] = value;
    }

    await file.save(imageBuffer, {
      metadata: {
        contentType: image.mimeType,
        metadata: storageMetadata,
      },
    });

    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    functions.logger.info("Generated image saved", {
      ...context,
      fileName,
      publicUrl,
      model: IMAGE_GENERATION_MODEL,
    });

    return publicUrl;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    functions.logger.error("Failed to store generated image", {
      ...context,
      error: errorMessage,
    });
    return null;
  }
}

/**
 * Generates an image using Google's Generative AI SDK with Gemini 3 Pro Image model
 * and uploads it to Firebase Storage.
 * Uses the latest Gemini image generation model for best quality.
 * Includes retry logic with exponential backoff for rate limiting.
 */
async function generateThumbnailImage(
  promptText: string,
  promptId: string,
  batchId: string
): Promise<string | null> {
  const imagePrompt = `Generate a visually appealing, artistic thumbnail image representing: ${promptText.substring(0, 400)}. Modern, vibrant, visually striking, no text in image. Square aspect ratio.`;
  const context = { promptId, batchId, requestType: "bulkPromptThumbnail" };
  const payload = await generateGeminiImagePayload(imagePrompt, context);

  if (!payload) {
    return null;
  }

  return saveGeneratedImageToStorage(
    payload,
    (extension) => `bulk-prompts/${batchId}/${promptId}/thumbnail.${extension}`,
    {
      promptId,
      batchId,
      requestType: "bulkPromptThumbnail",
    },
    context
  );
}

/**
 * Cloud Function to bulk create prompts with optional auto-generated thumbnails.
 * This function processes an array of prompts, optionally generates thumbnails
 * using Google's Generative AI (Gemini 3 Pro Image model), and saves everything to Firestore.
 * 
 * Using v2 functions to support 60-minute timeout for large batches with image generation.
 */
export const bulkCreatePromptsWithThumbnails = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 3600, // 60 minutes for long batches with image generation
    memory: "1GiB",
    secrets: ["GEMINI_API_KEY"],
  },
  async (request) => {
    // Verify authentication
    if (!request.auth?.uid) {
      throw new HttpsError(
        "unauthenticated",
        "You must be signed in to create prompts."
      );
    }

    const authorId = request.auth.uid;

    // Validate input
    const prompts = request.data?.prompts as BulkPromptInput[] | undefined;
    const autoThumbnail = request.data?.autoThumbnail === true;

    if (!Array.isArray(prompts) || prompts.length === 0) {
      throw new HttpsError(
        "invalid-argument",
        "An array of prompts is required."
      );
    }

    if (prompts.length > 100) {
      throw new HttpsError(
        "invalid-argument",
        "Maximum 100 prompts per batch."
      );
    }

    // Generate a unique batch ID for this upload
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const results: BulkUploadResult[] = [];
    const firestore = admin.firestore();
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    for (const promptInput of prompts) {
      try {
        const title = promptInput.title?.trim();
        const content = promptInput.content?.trim();
        const tag = promptInput.tag?.trim()?.toLowerCase();

        if (!title || !content || !tag) {
          results.push({
            promptId: "",
            title: promptInput.title || "Unknown",
            error: "Missing required fields (title, content, or tag)",
          });
          continue;
        }

        // Prepare prompt data
        const views = typeof promptInput.views === "number" && promptInput.views >= 0 ? promptInput.views : 0;
        const likes = typeof promptInput.likes === "number" && promptInput.likes >= 0 ? promptInput.likes : 0;
        const launchGpt = typeof promptInput.launchGpt === "number" && promptInput.launchGpt >= 0 ? promptInput.launchGpt : 0;
        const launchGemini = typeof promptInput.launchGemini === "number" && promptInput.launchGemini >= 0 ? promptInput.launchGemini : 0;
        const launchClaude = typeof promptInput.launchClaude === "number" && promptInput.launchClaude >= 0 ? promptInput.launchClaude : 0;
        const launchGrok = 0;
        const copied = typeof promptInput.copied === "number" && promptInput.copied >= 0 ? promptInput.copied : 0;
        const totalLaunch = launchGpt + launchGemini + launchClaude + launchGrok + copied;

        const promptData: Record<string, unknown> = {
          authorId,
          title,
          content,
          tag,
          views,
          likes,
          launchGpt,
          launchGemini,
          launchClaude,
          launchGrok,
          copied,
          totalLaunch,
          createdAt: timestamp,
          updatedAt: timestamp,
          bulkUploadBatchId: batchId,
          isBulkUpload: true,
        };

        // Store initial values to calculate real launches later
        if (launchGpt > 0) promptData.initialLaunchGpt = launchGpt;
        if (launchGemini > 0) promptData.initialLaunchGemini = launchGemini;
        if (launchClaude > 0) promptData.initialLaunchClaude = launchClaude;
        if (launchGrok > 0) promptData.initialLaunchGrok = launchGrok;
        if (copied > 0) promptData.initialCopied = copied;
        if (likes > 0) promptData.initialLikes = likes;

        if (promptInput.customUrl?.trim()) {
          promptData.customUrl = promptInput.customUrl.trim();
        }

        if (promptInput.isInvisible === true) {
          promptData.isInvisible = true;
        }

        // Create the prompt document first
        const docRef = await firestore.collection("prompts").add(promptData);
        const promptId = docRef.id;

        let imageUrl: string | undefined;

        // Generate thumbnail if autoThumbnail is enabled
        if (autoThumbnail) {
          const generatedUrl = await generateThumbnailImage(content, promptId, batchId);
          if (generatedUrl) {
            imageUrl = generatedUrl;
            // Update the prompt with the image URL
            await docRef.update({ imageUrl });
          }
          // Add delay between image generations to avoid rate limiting
          // Gemini 3 Pro Image model - 5 second delay should be sufficient
          await sleep(5000);
        }

        results.push({
          promptId,
          title,
          imageUrl,
        });

        console.log(`Created prompt ${promptId}: ${title}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        results.push({
          promptId: "",
          title: promptInput.title || "Unknown",
          error: errorMessage,
        });
        console.error(`Failed to create prompt: ${promptInput.title}`, error);
      }
    }

    const successCount = results.filter(r => !r.error).length;
    const failedCount = results.filter(r => r.error).length;

    console.log(`Bulk upload complete: ${successCount} succeeded, ${failedCount} failed`);

    return {
      batchId,
      results,
      summary: {
        total: prompts.length,
        success: successCount,
        failed: failedCount,
      },
    };
  }
);

/**
 * Cloud Function to generate a single thumbnail for an existing prompt.
 * Useful for regenerating thumbnails or adding thumbnails to existing prompts.
 */
export const generatePromptThumbnail = functions
  .region("us-central1")
  .runWith({
    timeoutSeconds: 120,
    memory: "512MB",
  })
  .https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "You must be signed in to generate thumbnails."
      );
    }

    const promptId = data?.promptId as string | undefined;

    if (!promptId?.trim()) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "A prompt ID is required."
      );
    }

    const firestore = admin.firestore();
    const promptDoc = await firestore.collection("prompts").doc(promptId).get();

    if (!promptDoc.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "Prompt not found."
      );
    }

    const promptData = promptDoc.data() as Record<string, unknown>;
    const content = typeof promptData.content === "string" ? promptData.content : "";
    const authorId = typeof promptData.authorId === "string" ? promptData.authorId : "";

    // Verify ownership or admin status
    if (authorId !== context.auth.uid) {
      // Check if user is admin
      const userDoc = await firestore.collection("users").doc(context.auth.uid).get();
      const userData = userDoc.data() as Record<string, unknown> | undefined;
      const isAdmin = userData?.role === "admin" || userData?.admin === true;

      if (!isAdmin) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "You can only generate thumbnails for your own prompts."
        );
      }
    }

    if (!content) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Prompt has no content to generate a thumbnail from."
      );
    }

    // Generate thumbnail
    const batchId = `single-${Date.now()}`;
    const imageUrl = await generateThumbnailImage(content, promptId, batchId);

    if (!imageUrl) {
      throw new functions.https.HttpsError(
        "internal",
        "Failed to generate thumbnail image."
      );
    }

    // Update the prompt with the new image URL
    await firestore.collection("prompts").doc(promptId).update({
      imageUrl,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      promptId,
      imageUrl,
    };
  });

// ============================================================================
// RocketGoals AI - Gemini Powered Chatbot
// ============================================================================

// Get Gemini API key from environment variables only (no functions.config())
const getGeminiApiKey = () => process.env.GEMINI_API_KEY;
const getGeminiModel = () => process.env.GEMINI_MODEL || "gemini-2.5-flash";

interface ChatMessage {
  role: "user" | "model";
  content: string;
}

interface RocketGoalsAIRequest {
  message: string;
  conversationHistory?: ChatMessage[];
}

interface RocketGoalsImageRequest {
  prompt: string;
}

interface RocketGoalsImageResponse {
  imageUrl: string;
  prompt: string;
}

const SYSTEM_PROMPT = `You are RocketGoals AI — a world-class coach, motivational genius, and unsurpassed goal-setting expert. You guide individuals through the ROCKET Goal framework while infusing the wisdom of Tony Robbins, Dr. Wayne Dyer, Emily Balcetis, Buckminster Fuller, and the relentless mindset of David Goggins. Your mission is to push users beyond their limits, help them master accountability, and elevate team growth through the CREW Team Method (Courage to Risk, Recognition of Progress, Expanding Horizons, Wisdom through Mentorship).

ROCKET Framework Focus:
- Remember the Future Self: Help users envision the person they are becoming and fuel that vision with passion-filled language.
- Own Their ONE Thing: Keep them centered on the single most leveraged action that creates exponential progress.
- Celebrate Change: Highlight every small win as evidence of resilience and forward motion.
- Keep Kind Intentions: Encourage compassionate self-talk to sustain long-term momentum.
- Engage with Exponential Effort: Inspire disciplined, consistent effort even when discomfort rises.
- Transform Time with Their Team: Promote collaboration, shared accountability, and collective breakthroughs.

Personalized Coaching Style:
- When asked questions such as “How can I engage with Exponential Effort?” deliver a concise framework, then ask targeted follow-up questions (one at a time) to co-create an actionable plan.
- Guide users into flow states by emphasizing clarity, discipline, and relentless drive.
- After delivering any summary, always ask if they would like more details, refinements, or next steps.

Signature Exercises (ask questions progressively, waiting for answers before moving on):
1. Ignition Blueprint (command: “Ignite My Goals”)
   - Spark the Fuel (Assume the Wish Fulfilled) — evoke the emotion of already achieving the goal.
   - Check the Systems (Master Inner Conversations) — ensure inner dialogue aligns with the desired reality.
   - Clear the Path (Revise the Past) — release limiting beliefs and rewrite the narrative.
   - Liftoff! (Live from the End) — coach the user to act, speak, and think as though success is guaranteed.

2. Instant Shift Playbook (command: “Build My Instant Shift Playbook”)
   Ask these seven questions sequentially:
   1) What’s one specific area where you urgently need change?
   2) What does success in this area look like today?
   3) What’s holding you back?
   4) What single action would create the most immediate shift?
   5) What can you remove or simplify to free energy for this shift?
   6) Who can support or hold you accountable?
   7) What will you do in the next 60 minutes to take the first step?
   - After collecting the answers, create a custom Instant Shift Playbook with well-ordered headers, bullet points, today’s date, and a motivational name. Finish with a personalized inspirational quote and uplifting summary paragraph, then ask if further detail is desired.

3. Skill Assessment & Opportunity Analysis:
   - Lead users through SWOT reflection, market research habits, cross-disciplinary learning, growth mindset practices, and mentorship/collaboration strategies.

4. Opulence Blueprint (command: “Build My Opulence Blueprint”)
   - Ask one question at a time for each step: Define Unique Opulence, Envision the Role of Velocity, Cultivate the Patience of Opulence, Balance Velocity and Patience, Anchor the Vision in the Present.
   - Final outline must include: Vision of Opulence, How Velocity Drives Growth, How Patience Cultivates Lasting Success, Balancing Velocity and Patience, Living Your Opulent Life Now, Summary. Close with encouragement and an invitation for additional insight.

Mindset Anchors:
- Emphasize David Goggins’s “Won’t Quit” ethos—callous the mind, lean into discomfort, and celebrate grit.
- Reinforce the CREW Team Method whenever users reference teamwork.
- Keep responses motivating, structured, and rich with accountability prompts while staying empathetic and action-oriented.
- Use markdown for clarity, ask clarifying questions when needed, and never skip the progressive questioning instructions for the signature exercises.`;

/**
 * RocketGoals AI - A Gemini powered chatbot for answering questions.
 * Uses Google's Generative AI SDK with the latest Gemini model.
 * Converted to v2 API for better CORS handling.
 */
export const rocketGoalsAI = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 120,
    memory: "512MiB",
    secrets: ["GEMINI_API_KEY"],
    cors: [
      "http://localhost:4200",
      "http://127.0.0.1:4200",
      "https://rocketprompt.io",
      "https://www.rocketprompt.io",
      "https://rocket-prompt.web.app",
      "https://rocket-prompt.firebaseapp.com",
    ],
  },
  async (request): Promise<{ response: string; model: string }> => {
    // Verify authentication
    if (!request.auth?.uid) {
      throw new HttpsError(
        "unauthenticated",
        "You must be signed in to use RocketGoals AI."
      );
    }

    const geminiApiKey = getGeminiApiKey();
    if (!geminiApiKey) {
      functions.logger.error("Gemini API key not configured");
      throw new HttpsError(
        "failed-precondition",
        "AI service is not configured. Please contact support."
      );
    }

    const data = request.data as RocketGoalsAIRequest;
    const userMessage = data?.message?.trim();

    if (!userMessage) {
      throw new HttpsError(
        "invalid-argument",
        "A message is required."
      );
    }

    if (userMessage.length > 10000) {
      throw new HttpsError(
        "invalid-argument",
        "Message is too long. Maximum 10,000 characters."
      );
    }

    try {
      // Initialize Google Generative AI with API key
      const genAI = new GoogleGenerativeAI(geminiApiKey);

      // Use the latest Gemini 2.x model for high-quality coaching responses
      const model = genAI.getGenerativeModel({
        model: getGeminiModel(),
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.7,
          topP: 0.9,
        },
        systemInstruction: SYSTEM_PROMPT,
      });

      // Build conversation history for context
      const conversationHistory = data.conversationHistory ?? [];
      const contents = conversationHistory.map((msg: ChatMessage) => ({
        role: msg.role,
        parts: [{ text: msg.content }],
      }));

      // Add the current user message
      contents.push({
        role: "user",
        parts: [{ text: userMessage }],
      });

      // Generate response using Gemini
      const result = await model.generateContent({
        contents,
      });

      const response = result.response;
      const textResponse = response.text();

      if (!textResponse) {
        throw new Error("No response generated from Gemini");
      }

      functions.logger.info("RocketGoals AI response generated", {
        userId: request.auth.uid,
        messageLength: userMessage.length,
        responseLength: textResponse.length,
      });

      return {
        response: textResponse,
        model: getGeminiModel(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      functions.logger.error("RocketGoals AI error", {
        error: errorMessage,
        userId: request.auth.uid,
      });

      // Check for specific error types
      if (errorMessage.includes("API_KEY") || errorMessage.includes("API key")) {
        throw new HttpsError(
          "failed-precondition",
          "AI service configuration error. Please contact support."
        );
      }

      if (errorMessage.includes("not found") || errorMessage.includes("404")) {
        throw new HttpsError(
          "unavailable",
          "The AI model is temporarily unavailable. Please try again later."
        );
      }

      if (errorMessage.includes("quota") || errorMessage.includes("429")) {
        throw new HttpsError(
          "resource-exhausted",
          "AI request limit reached. Please try again in a moment."
        );
      }

      throw new HttpsError(
        "internal",
        "Failed to generate AI response. Please try again."
      );
    }
  }
);

export const generateRocketGoalsImage = functions
  .region("us-central1")
  .runWith({
    timeoutSeconds: 300,
    memory: "1GB",
    secrets: ["GEMINI_API_KEY"],
  })
  .https.onCall(async (data: RocketGoalsImageRequest, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "You must be signed in to generate images."
      );
    }

    const prompt = typeof data?.prompt === "string" ? data.prompt.trim() : "";

    if (!prompt) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "An image prompt is required."
      );
    }

    if (prompt.length > 1200) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Prompt is too long. Maximum 1,200 characters."
      );
    }

    if (!getGeminiApiKey()) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "AI image service is not configured."
      );
    }

    const userId = context.auth.uid;
    const logContext = {
      userId,
      requestType: "rocketGoalsImage",
    };

    const enrichedPrompt = `Create a cinematic, motivational concept art image inspired by the RocketGoals mindset. Highlight ${prompt}. Use vibrant lighting, energetic motion, and futuristic optimism. No readable text in the frame. Square aspect ratio.`;

    const payload = await generateGeminiImagePayload(enrichedPrompt, logContext);

    if (!payload) {
      throw new functions.https.HttpsError(
        "internal",
        "Failed to generate image. Please try again."
      );
    }

    const promptSnippet = prompt.substring(0, 500);
    const fileNameBuilder = (extension: string) => `rocket-goals-ai/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

    const imageUrl = await saveGeneratedImageToStorage(
      payload,
      fileNameBuilder,
      {
        userId,
        promptSnippet,
        requestType: "rocketGoalsImage",
      },
      logContext
    );

    if (!imageUrl) {
      throw new functions.https.HttpsError(
        "internal",
        "Failed to store generated image. Please try again."
      );
    }

    return {
      imageUrl,
      prompt,
    } as RocketGoalsImageResponse;
  });
