#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>

extern void blazeTrayStart(void);

// Runs systray's start function on the main thread, where AppKit wants it.
void blazeOnMain(void) {
	dispatch_async(dispatch_get_main_queue(), ^{ blazeTrayStart(); });
}

void blazeAskAccessibility(void) {
	NSDictionary *opts = @{(id)kAXTrustedCheckOptionPrompt: @YES};
	AXIsProcessTrustedWithOptions((CFDictionaryRef)opts);
}
