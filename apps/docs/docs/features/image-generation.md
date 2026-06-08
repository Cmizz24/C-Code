---
description: Generate new images from text prompts or edit existing images in Roo Code using configured image-generation providers. Transform, enhance, and save AI-processed images to your workspace with preview support.
keywords:
    - image generation
    - image editing
    - text to image
    - image transformation
    - OpenRouter
    - Cloudflare Workers AI
    - Workers AI
    - AI images
    - image-generation providers
    - image creation
    - prompt to image
    - watercolor
    - upscaling
    - style transfer
---

# Image Generation

Generate new images from text prompts or edit existing images in your workspace. Save results to your project with preview in chat. Configure a supported image-generation provider in the dedicated Image Generation settings.

---

## Key Features

- Create new images from text prompts using natural language
- Edit and transform existing images in your workspace
- Saves to your workspace at a path you choose; appropriate extension (.png or .jpg) is auto-added if missing
- Shows a preview of the generated/edited image in the conversation
- Shows safe provider metadata in chat, including usage details when providers report them
- Supports remote providers such as OpenRouter, OpenAI/OpenAI-compatible endpoints, and Cloudflare Workers AI
- Keeps image-generation provider settings separate from chat provider profiles

---

## Use Cases

### Image Generation

**Before:** You had to copy prompts to an external site, download the result, then move it into your workspace.

**With this feature:** Ask Roo to generate an image, approve, pick a save location, and continue editing with the image already in your project.

### Image Editing

**Before:** Export image, upload to external editor, make changes, download, import back to project.

**With this feature:** Ask Roo to transform your existing image directly - it reads the file, applies your edits, and saves the result in your project.

---

## How It Works

When invoked, Roo sends your prompt (and optionally an existing image) to your configured image-generation provider. The generated or edited image returned by the provider is saved to the path you specify inside your current workspace. Roo shows a preview in chat and the file appears in your file explorer.

---

## Requirements

- A configured image-generation provider
- Internet access for the configured provider
- An open, writable workspace folder

---

## Configuration

### 1. Choose an Image Generation Provider

- **Purpose:** Selects which provider Roo uses for image generation
- **Default:** OpenRouter
- **Location:** Settings > Image Generation
- **Supported providers:** OpenRouter, OpenAI/OpenAI-compatible, and Cloudflare Workers AI

### 2. Configure Credentials or Compatible Endpoint

- Add the required API key or token. For OpenRouter, get your key at [https://openrouter.ai/keys](https://openrouter.ai/keys). For Cloudflare Workers AI, configure an API token plus your Cloudflare account ID.
- For OpenAI-compatible providers or proxies, configure the base URL that exposes an image-generation API.
- For Cloudflare Workers AI, the default base URL is `https://api.cloudflare.com/client/v4`; Roo sends requests to `/accounts/{account}/ai/run/{model}` and authenticates with `Authorization: Bearer {token}`.

### 3. Image Generation Model and API Method

- **Purpose:** Selects which model to use for generation
- **Default:** Provider-specific default model
- **OpenRouter model list:** Shows available image-output models separately from the normal chat model picker
- **API method:** Uses the provider-supported method, such as Chat Completions, Images API, or Workers AI

### 4. Cloudflare Workers AI Pricing Guidance

When Cloudflare Workers AI is selected, the Image Generation settings show Cloudflare's free allocation and Neuron pricing guidance. The displayed guidance includes the free daily allocation, reset time, paid overage rate, and model-specific pricing details where available.

The settings panel also shows a local estimate of Workers AI image-generation usage for the current UTC day. This estimate tracks image generations run from Roo, derives estimated remaining free Neurons from the 10,000 Neurons per day free allocation, and resets at 00:00 UTC. Cloudflare does not provide Roo a documented daily remaining-quota API here, so use the Cloudflare dashboard as the source of provider-confirmed usage before generating production assets.

---

## Using Image Generation

1. In chat, ask Roo to generate an image and describe what you want (subject, style, lighting, composition).
2. Review the proposed prompt and confirm the action when prompted. You can edit the prompt before approving.
3. Roo generates the image and saves it. If you don't include an extension, the appropriate extension (.png or .jpg) is added based on the output format.
4. See the image preview and safe provider metadata in chat, then locate the file in your workspace. For Cloudflare Workers AI, chat metadata can include provider-reported or locally estimated Neurons, estimated cost, local daily usage, estimated remaining free Neurons, reset time, and pricing/quota notes when available.

---

## Editing Existing Images

Roo can also transform and edit existing images in your workspace:

1. Ask Roo to edit an image, describing the transformation you want
2. Specify both the input image path and where to save the result
3. Roo will apply your requested edits to the existing image

**Supported Input Formats**: PNG, JPG, JPEG, GIF, WEBP

**Example Requests**:

- "Transform `photos/portrait.jpg` into a watercolor painting and save as `art/watercolor-portrait.png`"
- "Upscale and enhance `images/logo.png` to higher resolution"
- "Apply a vintage filter to `screenshots/app.png`"

**Note**: Both the input image path and output path must be accessible (not blocked by `.rooignore`)

---

## Tips for Better Results

### Be Specific

Include these elements in your prompts:

- **Style:** artistic medium, art movement, or specific artist style
- **Mood:** emotional tone, atmosphere
- **Color palette:** specific colors or color schemes
- **Camera/lighting:** angle, perspective, lighting conditions
- **Aspect ratio:** dimensions or orientation

---

## Limitations

- Provider availability and model lists vary by provider
- Vision or image-understanding chat models are not image-generation models
- OpenRouter, OpenAI-compatible, and Cloudflare Workers AI provider limits, costs, and model availability can change; confirm current details in the provider dashboard
- Cloudflare Workers AI remaining free Neurons shown in Roo are local estimates based on Roo image generations, not provider-confirmed quota readings
- One image is produced per request
- Output formats supported: PNG or JPG
- Supported input formats for editing: PNG, JPG, JPEG, GIF, WEBP only
- Image paths must be accessible (not blocked by `.rooignore` restrictions)
- Usage may be subject to your provider plan limits and costs

---

## Status

Provider behavior and supported models may change over time. Provide feedback through [GitHub Issues](https://github.com/RooCodeInc/Roo-Code/issues).
