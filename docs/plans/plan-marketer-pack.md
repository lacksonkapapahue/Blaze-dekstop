# Marketer and seller pack (v0.17.0)

Plan part D of `plan-v1.0-redesign.md`. Purpose: help Luke run and grow an online store (his HomeGlow Shopify dropshipping store) and its social media from inside Blaze, on free tools.

## What shipped
Six skills in the shared `skills/` pack (Blaze Android reuses the same files); 40 bundled skills now.

| Skill | What it does | Built on |
|---|---|---|
| content-calendar | A week of posts (hook, caption, hashtags, time), visuals in the Design studio with the brand kit (`post` 1080×1350 / `story` 1080×1920 artboards), each post a `once` Schedule item | Design studio, brand kit (frontend/dist/brand.js + studio.Brand in the prompt), `schedule once` (v0.15) |
| product-listing | Supplier URL (AliExpress, Zendrop, CJ, Alibaba, Temu) → title, description, specs, tags, SEO, price maths, 4-6 image prompts, Shopify import CSV | fetch_page, api-integration for the Admin API |
| ad-lab | 5 variants with different angles, scored 0-10 on hook, clarity and CTA, sorted best first, policy check, test plan | — |
| research-brief | One-page competitor + pricing brief with dated, sourced prices and a recommended price | deep-research skill (loaded, its sourcing rules followed) |
| whatsapp-replies | Draft customer replies on desktop; send one by one through the paired phone with `phone_ask` | Blaze Link (v0.14), Android DesktopLink |
| weekly-digest | Weekly scheduled job: orders/revenue vs last week, best sellers, problems, top posts, next posts | Shopify Admin API or CSV export, `schedule weekly`, notify |

## Approval for messages
`phone_ask` now spots requests that send something in the user's name (send, text, WhatsApp, message, reply, email, post…) and asks **Send through your phone?** with the exact text before the request leaves the PC. It uses `Env.Approve` (`a.confirm`), which is never auto-approved: not by Autopilot, not by auto-approve. Blaze Android asks again on the phone. Declined = nothing sent. Read-only phone requests (battery, read messages) don't ask.

## Tests
`TestPhoneAskSendNeedsApproval` (declined send never reaches the phone even with Yolo; approved send does; reads don't ask), skillpack index (40). Shots: marketer-skills, marketer-whatsapp-approve.
