---
description: Generate new images from text prompts or edit existing images in Roo Code using configured image-generation providers. Transform, enhance, and save AI-processed images to your workspace with preview support.
keywords:
    - image generation
    - image editing
    - text to image
    - image transformation
    - OpenRouter
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
- Supports remote providers such as OpenRouter and OpenAI/OpenAI-compatible endpoints
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
- **Supported providers:** OpenRouter and OpenAI/OpenAI-compatible

### 2. Configure Credentials or Compatible Endpoint

- Add the required API key. For OpenRouter, get your key at [https://openrouter.ai/keys](https://openrouter.ai/keys).
- For OpenAI-compatible providers or proxies, configure the base URL that exposes an image-generation API.

### 3. Image Generation Model and API Method

- **Purpose:** Selects which model to use for generation
- **Default:** Provider-specific default model
- **OpenRouter model list:** Shows available image-output models separately from the normal chat model picker
- **API method:** Uses the provider-supported method, such as Chat Completions or Images API

---

## Using Image Generation

1. In chat, ask Roo to generate an image and describe what you want (subject, style, lighting, composition).
2. Review the proposed prompt and confirm the action when prompted. You can edit the prompt before approving.
3. Roo generates the image and saves it. If you don't include an extension, the appropriate extension (.png or .jpg) is added based on the output format.
4. See the image preview and safe provider metadata in chat, then locate the file in your workspace.

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
- OpenRouter and OpenAI-compatible provider limits, costs, and model availability can change; confirm current details in the provider dashboard
- One image is produced per request
- Output formats supported: PNG or JPG
- Supported input formats for editing: PNG, JPG, JPEG, GIF, WEBP only
- Image paths must be accessible (not blocked by `.rooignore` restrictions)
- Usage may be subject to your provider plan limits and costs

---

## Status

Provider behavior and supported models may change over time. Provide feedback through [GitHub Issues](https://github.com/RooCodeInc/Roo-Code/issues).
