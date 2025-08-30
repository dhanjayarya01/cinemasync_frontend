"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, Download, X } from "lucide-react";

/**
 * Strict PWAProvider with verbose logging.
 * - Only shows on landing page ("/"), only once (session + persistent dismiss).
 */
export function PWAProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [deferredPromptCapturedAt, setDeferredPromptCapturedAt] = useState<string | null>(null);

  const [isInstalled, setIsInstalled] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);

  // final guard for rendering the UI
  const [canShowInstall, setCanShowInstall] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // helpers
  const readDismissed = () =>
    typeof window !== "undefined" && localStorage.getItem("pwa-install-dismissed") === "true";
  const readSessionShown = () =>
    typeof window !== "undefined" && sessionStorage.getItem("pwa-install-shown") === "true";
  const readInstalledMedia = () =>
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(display-mode: standalone)").matches;

  // DEV helpers exposed to console
  if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
    (window as any).resetPWAPrompt = () => {
      localStorage.removeItem("pwa-install-dismissed");
      sessionStorage.removeItem("pwa-install-shown");
      setDeferredPrompt(null);
      setDeferredPromptCapturedAt(null);
      setCanShowInstall(false);
      console.info("[PWA DEBUG] reset: removed storage keys and cleared prompt");
      window.location.reload();
    };

    (window as any).printPWADebug = () => {
      console.info("[PWA DEBUG] state:", {
        pathname,
        deferredPromptExists: !!deferredPrompt,
        deferredPromptCapturedAt,
        installed: readInstalledMedia(),
        dismissed: readDismissed(),
        sessionShown: readSessionShown(),
        canShowInstall,
      });
    };
  }

  // Register listeners (run once)
  useEffect(() => {
    if (typeof window === "undefined") return;

    console.info("[PWA] init listeners");

    const handleOnline = () => {
      setIsOnline(true);
      console.debug("[PWA] online");
    };
    const handleOffline = () => {
      setIsOnline(false);
      console.debug("[PWA] offline");
    };

    const handleBeforeInstallPrompt = (e: Event) => {
      // Use pathname from hook instead of window.location
      const dismissed = localStorage.getItem("pwa-install-dismissed") === "true";
      const installedNow =
        window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;

      console.info("[PWA] beforeinstallprompt event fired", {
        currentPath: pathname,
        dismissed,
        installedNow,
      });

      // STRICT: only capture the event if fired while user is on the landing page
      if (pathname !== "/" || dismissed || installedNow) {
        console.info("[PWA] beforeinstallprompt ignored (not on landing / dismissed / installed)");
        // do not preventDefault so browser may use its own flow
        return;
      }

      // Prevent default prompt and stash it
      e.preventDefault();
      setDeferredPrompt(e);
      setDeferredPromptCapturedAt(pathname);
      console.info("[PWA] deferredPrompt captured at", pathname);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setDeferredPromptCapturedAt(null);
      setCanShowInstall(false); // Add this line
      try {
        localStorage.setItem("pwa-install-dismissed", "true");
      } catch (err) {
        /* ignore */
      }
      console.info("[PWA] appinstalled -> marked as installed and dismissed permanently");
    };

    const registerServiceWorker = async () => {
      if ("serviceWorker" in navigator) {
        try {
          const registration = await navigator.serviceWorker.register("/sw.js");
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                  setShowUpdatePrompt(true);
                  console.info("[PWA] service worker update found -> show update prompt");
                }
              });
            }
          });
          console.debug("[PWA] service worker registered", registration);
        } catch (err) {
          console.error("[PWA] service worker register failed", err);
        }
      }
    };

    // initial checks
    if (readInstalledMedia()) {
      setIsInstalled(true);
      console.info("[PWA] detected installed mode (standalone)");
    }

    registerServiceWorker();

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      console.info("[PWA] removed listeners");
    };
  }, [pathname]); // Add pathname as dependency

  // Strict evaluation: re-evaluate all conditions whenever pathname, deferredPrompt, or install changes
  useEffect(() => {
    if (typeof window === "undefined") {
      setCanShowInstall(false);
      return;
    }

    const dismissed = readDismissed();
    const sessionShown = readSessionShown();
    const installedNow = readInstalledMedia();

    // strict rules (must all be true to show)
    const allowed =
      pathname === "/" && // must be landing page (using hook pathname)
      deferredPrompt !== null && // we have captured event
      deferredPromptCapturedAt === "/" && // it was captured while on '/'
      !installedNow && // not installed
      !dismissed && // user not permanently dismissed
      !sessionShown; // not shown in this session/tab

    console.debug("[PWA] strict evaluation", {
      pathname,
      deferredPromptExists: !!deferredPrompt,
      deferredPromptCapturedAt,
      installedNow,
      dismissed,
      sessionShown,
      allowed,
    });

    setCanShowInstall(Boolean(allowed));
  }, [pathname, deferredPrompt, deferredPromptCapturedAt, isInstalled]);

  // IMMEDIATELY hide prompt when leaving landing page
  useEffect(() => {
    if (pathname !== "/") {
      console.info("[PWA] not on landing page, ensuring prompt is hidden");
      setCanShowInstall(false);
      // Clear the prompt to prevent it from showing again if user returns
      if (deferredPrompt) {
        console.info("[PWA] clearing deferredPrompt due to navigation away from landing");
        setDeferredPrompt(null);
        setDeferredPromptCapturedAt(null);
      }
    }
  }, [pathname, deferredPrompt]);

  // install handler
  const handleInstallPWA = async () => {
    if (!deferredPrompt) {
      console.warn("[PWA] handleInstallPWA called but no deferredPrompt available");
      return;
    }
    console.info("[PWA] user triggered install prompt");
    try {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      console.info("[PWA] userChoice", choice);
      if (choice?.outcome === "accepted") {
        try {
          localStorage.setItem("pwa-install-dismissed", "true");
          console.info("[PWA] install accepted -> permanent dismiss saved");
        } catch (err) {
          console.warn("[PWA] could not persist install state", err);
        }
      } else {
        console.info("[PWA] install dismissed by user via native prompt");
      }
    } catch (err) {
      console.error("[PWA] error prompting install", err);
    } finally {
      setDeferredPrompt(null);
      setDeferredPromptCapturedAt(null);
      setCanShowInstall(false);
    }
  };

  const handleDismissInstall = () => {
    console.info("[PWA] user dismissed custom install UI -> persist dismiss");
    try {
      localStorage.setItem("pwa-install-dismissed", "true");
      sessionStorage.setItem("pwa-install-shown", "true");
    } catch (err) {
      console.warn("[PWA] could not persist dismissal", err);
    }
    setDeferredPrompt(null);
    setDeferredPromptCapturedAt(null);
    setCanShowInstall(false);
  };

  // update handler unchanged
  const handleUpdatePWA = () => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        registration.waiting?.postMessage({ type: "SKIP_WAITING" });
      });
    }
    setShowUpdatePrompt(false);
    window.location.reload();
  };

  return (
    <>
      {children}

      {/* Install UI: Small button or expanded card */}
      {canShowInstall && pathname === "/" && (
        <div className="fixed bottom-4 right-4 z-50">
          {!isMinimized ? (
            // Full install card (when expanded)
            <div className="animate-in slide-in-from-bottom-4 duration-300">
              <Card className="bg-white/95 backdrop-blur-sm border-purple-200 shadow-lg max-w-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Download className="h-5 w-5 text-purple-600" />
                    Install CinemaSync
                  </CardTitle>
                  <CardDescription>
                    Install our app for a better experience with offline support and quick access.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex gap-2">
                  <Button 
                    onClick={handleInstallPWA} 
                    className="flex-1 bg-purple-600 hover:bg-purple-700"
                    size="sm"
                  >
                    Install  this App
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => setIsMinimized(true)} 
                    className="px-3"
                    size="sm"
                    title="Minimize"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : (
            // Small install button (default state)
            <div className="animate-in fade-in duration-200">
              <div className="flex flex-col gap-1">
                {/* Main install button */}
                <Button
                  onClick={handleExpandInstall}
                  className="bg-purple-600 hover:bg-purple-700 text-black shadow-lg text-xs px-3 py-2 h-auto min-w-0"
                  title="Install CinemaSync App"
                >
                  Install
                </Button>
                {/* Tiny dismiss button below */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleDismissInstall}
                  className="w-6 h-6 text-gray-400 hover:text-gray-600 hover:bg-gray-100 self-center"
                  title="Dismiss forever"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Update and offline UIs unchanged */}
      {showUpdatePrompt && (
        <div className="fixed bottom-4 left-4 right-4 z-50">
          <Card className="bg-white/95 border-blue-200 shadow-lg">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <RefreshCw className="h-5 w-5 text-blue-600" />
                Update Available
              </CardTitle>
              <CardDescription>
                A new version of CinemaSync is available. Update now for the latest features.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button onClick={handleUpdatePWA} className="flex-1 bg-blue-600 hover:bg-blue-700">
                Update Now
              </Button>
              <Button variant="outline" onClick={() => setShowUpdatePrompt(false)} className="px-4">
                <X className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {!isOnline && (
        <div className="fixed top-4 left-4 right-4 z-50">
          <Card className="bg-orange-50 border-orange-200">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 text-orange-800">
                <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-medium">You're offline. Some features may be limited.</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}