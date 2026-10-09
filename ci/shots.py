# Screenshots of the UI with a fake backend, pushed to the `shots` branch by CI.
import pathlib, sys
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
out = root / "shots"; out.mkdir(exist_ok=True)
mock = (root / "ci" / "mock.js").read_text()
url = (root / "frontend" / "dist" / "index.html").as_uri()
with sync_playwright() as p:
    b = p.chromium.launch()
    for theme in ["light", "dark"]:
        pg = b.new_page(viewport={"width": 1280, "height": 820}, device_scale_factor=1)
        pg.add_init_script(f"window.__theme='{theme}';" + mock)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(url); pg.wait_for_timeout(600)
        pg.screenshot(path=str(out / f"home-{theme}.png"))
        pg.evaluate("show('chat', window.__conv)"); pg.wait_for_timeout(300)
        pg.screenshot(path=str(out / f"chat-{theme}.png"))
        for v in ["settings", "doctor", "setup", "schedule"]:
            pg.evaluate(f"show('{v}')"); pg.wait_for_timeout(400)
            pg.screenshot(path=str(out / f"{v}-{theme}.png"))
        if errs:
            print("JS errors:", errs); sys.exit(1)
    b.close()
print("ok")
