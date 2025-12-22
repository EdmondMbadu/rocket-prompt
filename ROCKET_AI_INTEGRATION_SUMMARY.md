# Rocket AI Integration Summary

## Overview
This document summarizes how "One Shot Rocket" and "Direct Launch Rocket" functionality works in the RocketPrompt codebase, providing the details needed to implement similar functionality in the Rocket Goals AI system.

---

## 1. ONE SHOT ROCKET

### What is One Shot Rocket?
One Shot Rocket is a feature that allows users to create a shareable link that automatically launches a prompt directly into Rocket AI when accessed. The link format is: `/{prompt-slug}/ROCKET` or `/prompt/{id}/ROCKET`.

### URL Pattern
- **Format**: `/{customUrl}/ROCKET` or `/prompt/{id}/ROCKET`
- **Example**: `https://rocketprompt.io/my-prompt-slug/ROCKET`
- **Route Matcher**: Uses `promptLaunchMatcher` function that matches URLs with exactly 2 segments where the second segment is "rocket" (case-insensitive)

### Flow & Implementation

#### Step 1: Link Generation
When a user clicks "One Shot Rocket" button:
1. **Location**: `prompt-page.component.ts` - `copyOneClickLink('rocket')` method
2. **URL Building**: `buildOneShotLink('rocket')` creates URL: `{baseUrl}/{promptIdentifier}/ROCKET`
   - Base URL: Current origin (e.g., `https://rocketprompt.io`)
   - Prompt identifier: Either `customUrl` or `/prompt/{shortId}` (first 8 chars of prompt ID)
   - Suffix: `/ROCKET` (uppercase)

#### Step 2: URL Access & Routing
When someone accesses the One Shot Rocket URL:
1. **Route Matching**: `prompt-launch.matcher.ts` matches the URL pattern
2. **Component**: `prompt-launch.component.ts` handles the request
3. **Parameters Extracted**:
   - `customUrl` or `id`: The prompt identifier
   - `target`: "rocket" (from URL segment)

#### Step 3: Prompt Loading
1. **Method**: `loadAndLaunch(identifier, identifierType)`
2. **Prompt Retrieval**:
   - If `identifierType === 'id'`: Calls `promptService.getPromptById(identifier)`
   - If `identifierType === 'custom'`: First tries `promptService.getPromptByCustomUrl(identifier)`, falls back to `getPromptById(identifier)`

#### Step 4: Launch Preparation
1. **Method**: `launchPrompt(prompt)` in `prompt-launch.component.ts`
2. **For Rocket Target**:
   ```typescript
   const launch = this.rocketGoalsLaunchService.prepareLaunch(text, prompt.id);
   url = launch.url;
   ```
3. **Launch Service** (`rocket-goals-launch.service.ts`):
   - Creates a unique token: `{timestamp}-{promptIdPrefix}-{randomString}`
   - Stores prompt text in `localStorage` with key: `rocketGoalsAutoPrompt:{token}`
   - Builds URL: `{origin}/ai?autoLaunch={encodedToken}`
   - Returns: `{ token, url, stored: boolean }`

#### Step 5: Redirect & Auto-Launch
1. **Redirect**: `window.location.replace(launch.url)` navigates to `/ai?autoLaunch={token}`
2. **Tracking**: Calls `promptService.trackLaunch(prompt.id, 'rocket')` to track the launch event

#### Step 6: Rocket AI Page Consumes Prompt
1. **Component**: `rocket-goals-ai-page.component.ts`
2. **Query Parameter Reading**: Reads `autoLaunch` query parameter
3. **Prompt Consumption**:
   ```typescript
   const token = params.get('autoLaunch');
   const payload = this.rocketGoalsLaunchService.consumePrompt(token);
   ```
4. **Consume Method**:
   - Reads from `localStorage` using key: `rocketGoalsAutoPrompt:{token}`
   - **Deletes the prompt from localStorage** (one-time use)
   - Returns prompt text or `null` if not found

#### Step 7: Auto-Send Message
1. **Method**: `triggerAutoLaunch(promptText)`
2. **Behavior**:
   - Sets `inputMessage` signal to the prompt text
   - Automatically calls `sendMessage()` after 100ms delay
   - Sets `autoLaunchHandled = true` to prevent duplicate launches

---

## 2. DIRECT LAUNCH ROCKET

### What is Direct Launch Rocket?
Direct Launch Rocket allows users to click a "Launch" button from any prompt card/page, which immediately opens Rocket AI in a new tab with the prompt ready to send.

### Flow & Implementation

#### Step 1: User Clicks Launch Button
**Locations where this is implemented**:
- `home.component.ts` - `launchRocketGoalsPrompt(prompt)`
- `collection-detail.component.ts` - `launchRocketGoalsPrompt(prompt)`
- `liked-prompts-page.component.ts` - `launchRocketGoalsPrompt(prompt)`
- `prompt-page.component.ts` - `launchRocketGoalsPrompt(text)`

#### Step 2: Launch Preparation
```typescript
const content = prompt.content ?? '';
const launch = this.rocketGoalsLaunchService.prepareLaunch(content, prompt.id ?? undefined);
```

**Same service as One Shot**:
- Creates token
- Stores prompt in localStorage
- Builds URL: `{origin}/ai?autoLaunch={token}`

#### Step 3: Open in New Tab
```typescript
if (typeof window !== 'undefined') {
  window.open(launch.url, '_blank');
}
```

#### Step 4: Fallback Behavior
If `localStorage` storage fails (`launch.stored === false`):
- **Copies prompt text to clipboard** using `copyTextForRocketGoals(content)`
- Shows message: "Prompt copied! Paste it into Rocket AI and tap Launch to send."
- If storage succeeds: Shows "Prompt ready in Rocket AI - tap Launch to send."

#### Step 5: Tracking
```typescript
await this.promptService.trackLaunch(prompt.id, 'rocket');
```

#### Step 6: Rocket AI Consumes (Same as One Shot)
- Reads `autoLaunch` query parameter
- Consumes prompt from localStorage
- Auto-sends the message

---

## 3. KEY SERVICES & METHODS

### RocketGoalsLaunchService

**Location**: `src/app/services/rocket-goals-launch.service.ts`

#### Methods:

1. **`prepareLaunch(promptText: string, promptId?: string): RocketGoalsLaunchPreparation`**
   - **Purpose**: Prepares a prompt for auto-launch
   - **Parameters**:
     - `promptText`: The full prompt content text
     - `promptId`: Optional prompt ID (used in token generation)
   - **Returns**: `{ token: string, url: string, stored: boolean }`
   - **Process**:
     - Creates unique token: `{timestamp}-{promptIdPrefix}-{randomString}`
     - Stores prompt in localStorage with key: `rocketGoalsAutoPrompt:{token}`
     - Builds URL: `{origin}/ai?autoLaunch={encodedToken}`
     - Returns success status

2. **`consumePrompt(token: string): string | null`**
   - **Purpose**: Retrieves and removes prompt from localStorage (one-time use)
   - **Parameters**: `token` - The token from URL query parameter
   - **Returns**: Prompt text or `null` if not found/expired
   - **Process**:
     - Reads from localStorage: `rocketGoalsAutoPrompt:{token}`
     - **Deletes the entry** after reading
     - Returns prompt text

#### Storage Key Format:
- **Prefix**: `rocketGoalsAutoPrompt:`
- **Full Key**: `rocketGoalsAutoPrompt:{token}`
- **Token Format**: `{timestamp}-{promptIdPrefix}-{randomString}`

#### URL Format:
- **Base**: Current origin (e.g., `https://rocketprompt.io`)
- **Path**: `/ai`
- **Query Parameter**: `?autoLaunch={encodedToken}`
- **Full Example**: `https://rocketprompt.io/ai?autoLaunch=1234567890-abc12345-xyz789`

---

## 4. ROCKET AI PAGE INTEGRATION

### Component: RocketGoalsAIPageComponent

**Location**: `src/app/pages/rocket-goals-ai/rocket-goals-ai-page.component.ts`

#### Key Integration Points:

1. **Query Parameter Reading** (Constructor):
   ```typescript
   this.route.queryParamMap.subscribe(params => {
     const token = params.get('autoLaunch');
     const inlinePrompt = params.get('prompt'); // Alternative method
     
     if (token && !this.autoLaunchHandled) {
       const payload = this.rocketGoalsLaunchService.consumePrompt(token);
       if (payload) {
         this.triggerAutoLaunch(payload);
       }
     }
   });
   ```

2. **Auto-Launch Method**:
   ```typescript
   private triggerAutoLaunch(promptText: string): void {
     if (this.autoLaunchHandled || !promptText?.trim()) {
       return;
     }
     
     this.autoLaunchHandled = true;
     this.inputMessage.set(promptText);
     
     setTimeout(() => {
       void this.sendMessage(); // Auto-send after 100ms
     }, 100);
   }
   ```

3. **Prevent Duplicate Launches**:
   - Uses `autoLaunchHandled` flag to ensure prompt is only auto-sent once
   - Checks flag before processing query parameters

---

## 5. PARAMETERS SUMMARY

### Input Parameters for Rocket AI Integration

#### From One Shot Rocket URL:
- **URL Pattern**: `/{promptIdentifier}/ROCKET`
- **Extracted Parameters**:
  - `customUrl` or `id`: Prompt identifier
  - `target`: "rocket"

#### From Direct Launch:
- **Prompt Object**: Contains `content` and `id`
- **No URL parameters needed** - uses localStorage

#### To Rocket AI Page:
- **Query Parameter**: `?autoLaunch={token}`
- **Token Format**: `{timestamp}-{promptIdPrefix}-{randomString}`
- **Alternative**: `?prompt={encodedPromptText}` (inline method, less common)

### Data Flow:

```
One Shot Rocket:
User clicks button → URL generated → User shares link → 
Link accessed → Prompt loaded → Token created → 
Prompt stored in localStorage → Redirect to /ai?autoLaunch={token} → 
Rocket AI reads token → Consumes from localStorage → Auto-sends message

Direct Launch:
User clicks Launch → Prompt content extracted → Token created → 
Prompt stored in localStorage → Open /ai?autoLaunch={token} in new tab → 
Rocket AI reads token → Consumes from localStorage → Auto-sends message
```

---

## 6. IMPLEMENTATION CHECKLIST FOR ROCKET AI

To implement this in Rocket Goals AI, you need:

### ✅ Required Components:

1. **URL Route Handler**
   - Handle route: `/ai` or equivalent Rocket AI page route
   - Read query parameter: `autoLaunch` or `prompt`

2. **Token-Based Storage System**
   - **Storage Key Format**: `rocketGoalsAutoPrompt:{token}`
   - **Storage Method**: `localStorage` (browser storage)
   - **Token Generation**: `{timestamp}-{promptIdPrefix}-{randomString}`
   - **One-Time Use**: Delete from storage after reading

3. **Auto-Launch Logic**
   - Read `autoLaunch` query parameter on page load
   - Consume prompt from localStorage using token
   - Set prompt text in input field
   - Auto-send message after short delay (100ms)
   - Prevent duplicate launches with a flag

4. **Fallback Behavior**
   - If localStorage fails, copy prompt to clipboard
   - Show user-friendly message about manual paste

5. **Prompt Consumption Method**
   - Function: `consumePrompt(token: string): string | null`
   - Reads from localStorage
   - **Deletes entry after reading** (one-time use)
   - Returns prompt text or null

6. **URL Building**
   - Format: `{origin}/ai?autoLaunch={encodedToken}`
   - Encode token properly for URL safety

### ✅ Key Behaviors:

- **One-Time Use**: Prompts are deleted from localStorage after consumption
- **Auto-Send**: Prompt automatically sends after page loads (100ms delay)
- **Duplicate Prevention**: Flag prevents multiple auto-launches
- **Error Handling**: Graceful fallback if localStorage unavailable
- **Tracking**: Track launch events (optional, for analytics)

---

## 7. EDGE CASES & CONSIDERATIONS

### Storage Limitations:
- **localStorage** has size limits (~5-10MB)
- If storage fails, fallback to clipboard copy
- Token-based approach allows expiration (can add TTL if needed)

### Security:
- Tokens are one-time use (deleted after consumption)
- Tokens are URL-encoded
- No sensitive data in tokens (just identifiers)

### Browser Compatibility:
- Requires `localStorage` support
- Fallback to clipboard API for older browsers
- Check `typeof window !== 'undefined'` for SSR compatibility

### URL Encoding:
- Token must be properly encoded: `encodeURIComponent(token)`
- Decode when reading: `decodeURIComponent(token)`

---

## 8. EXAMPLE IMPLEMENTATION FLOW

### Scenario: User shares One Shot Rocket link

1. **Link Generated**: `https://rocketprompt.io/my-prompt/ROCKET`
2. **User Clicks Link**:
   - Route matcher identifies pattern
   - Loads `PromptLaunchComponent`
   - Extracts: `customUrl = "my-prompt"`, `target = "rocket"`
3. **Prompt Loaded**: Fetches prompt from database
4. **Token Created**: `1703123456789-mypro-abc123`
5. **Storage**: `localStorage.setItem('rocketGoalsAutoPrompt:1703123456789-mypro-abc123', promptText)`
6. **Redirect**: `window.location.replace('https://rocketprompt.io/ai?autoLaunch=1703123456789-mypro-abc123')`
7. **Rocket AI Page Loads**:
   - Reads query param: `autoLaunch = "1703123456789-mypro-abc123"`
   - Calls: `consumePrompt("1703123456789-mypro-abc123")`
   - Reads from localStorage
   - **Deletes entry**
   - Returns prompt text
8. **Auto-Send**: Sets input field, waits 100ms, sends message
9. **User Sees**: Prompt automatically sent in Rocket AI chat

---

## 9. SUMMARY FOR ROCKET AI IMPLEMENTATION

### What Rocket AI Needs to Handle:

1. **Query Parameter**: `?autoLaunch={token}`
2. **Storage Key**: `rocketGoalsAutoPrompt:{token}`
3. **Consumption**: Read and delete from localStorage
4. **Auto-Send**: Set input field and send message automatically
5. **One-Time Use**: Delete after consumption
6. **Fallback**: Copy to clipboard if storage fails

### Key Methods to Implement:

```typescript
// 1. Consume prompt from storage
consumePrompt(token: string): string | null {
  const key = `rocketGoalsAutoPrompt:${token}`;
  const prompt = localStorage.getItem(key);
  if (prompt) {
    localStorage.removeItem(key); // One-time use
    return prompt;
  }
  return null;
}

// 2. Auto-launch handler
handleAutoLaunch(token: string): void {
  const promptText = this.consumePrompt(token);
  if (promptText) {
    this.inputMessage.set(promptText);
    setTimeout(() => this.sendMessage(), 100);
  }
}

// 3. Read query parameter on page load
ngOnInit() {
  this.route.queryParamMap.subscribe(params => {
    const token = params.get('autoLaunch');
    if (token) {
      this.handleAutoLaunch(token);
    }
  });
}
```

---

## END OF SUMMARY

This document provides all the details needed to implement One Shot Rocket and Direct Launch Rocket functionality in the Rocket Goals AI system. The key is the token-based localStorage mechanism that allows seamless prompt transfer between pages.

