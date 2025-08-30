"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RefreshCw, Download, X } from "lucide-react";

export function PWAProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [deferredPromptCapturedAt, setDeferredPromptCapturedAt] = useState<
    string | null
  >(null);

  const [isInstalled, setIsInstalled] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);

  // New states
  const [canShowInstall, setCanShowInstall] = useState(false); // big card
  const [showMiniInstall, setShowMiniInstall] = useState(false); // small button

  // --- Helpers ---
  const readSessionShown = () =>
    typeof window !== "undefined" &&
    sessionStorage.getItem("pwa-install-shown") === "true";
  const readInstalledMedia = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(display-mode: standalone)").matches;

  // --- Setup listeners ---
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    const handleBeforeInstallPrompt = (e: Event) => {
      const currentPath = window.location.pathname;
      const installedNow = readInstalledMedia();

      if (currentPath !== "/" || installedNow) return;

      e.preventDefault();
      setDeferredPrompt(e);
      setDeferredPromptCapturedAt(currentPath);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setDeferredPromptCapturedAt(null);
    };

    const registerServiceWorker = async () => {
      if ("serviceWorker" in navigator) {
        try {
          const registration = await navigator.serviceWorker.register("/sw.js");
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (
                  newWorker.state === "installed" &&
                  navigator.serviceWorker.controller
                ) {
                  setShowUpdatePrompt(true);
                }
              });
            }
          });
        } catch (err) {
          console.error("[PWA] sw register failed", err);
        }
      }
    };

    if (readInstalledMedia()) setIsInstalled(true);
    registerServiceWorker();

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  // --- Strict evaluation for showing install UI ---
  useEffect(() => {
    if (typeof window === "undefined") return;

    const currentPath = window.location.pathname;
    const allowed =
      currentPath === "/" &&
      deferredPrompt &&
      deferredPromptCapturedAt === "/" &&
      !readInstalledMedia();

    // First time -> show card
    if (allowed && !readSessionShown()) {
      setCanShowInstall(true);
      setShowMiniInstall(false);
    } else if (allowed) {
      // Later visits -> always show mini button
      setCanShowInstall(false);
      setShowMiniInstall(true);
    } else {
      setCanShowInstall(false);
      setShowMiniInstall(false);
    }
  }, [pathname, deferredPrompt, deferredPromptCapturedAt, isInstalled]);

  // Clear prompt when leaving landing page
  useEffect(() => {
    if (pathname !== "/") {
      setDeferredPrompt(null);
      setDeferredPromptCapturedAt(null);
      setCanShowInstall(false);
      setShowMiniInstall(false);
    }
  }, [pathname]);

  // Mark sessionStorage when full card shown
  useEffect(() => {
    if (canShowInstall) {
      sessionStorage.setItem("pwa-install-shown", "true");
    }
  }, [canShowInstall]);

  // --- Handlers ---
  const handleInstallPWA = async () => {
    if (!deferredPrompt) return;
    try {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch (err) {
      console.error("[PWA] install error", err);
    } finally {
      setDeferredPrompt(null);
      setDeferredPromptCapturedAt(null);
      setCanShowInstall(false);
      setShowMiniInstall(true); // always keep small button after
    }
  };

  const handleDismissInstall = () => {
    sessionStorage.setItem("pwa-install-shown", "true"); // only hide full card for this session
    setCanShowInstall(false);
    setShowMiniInstall(true); // still show mini button
  };

  const handleUpdatePWA = () => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        registration.waiting?.postMessage({ type: "SKIP_WAITING" });
      });
    }
    setShowUpdatePrompt(false);
    window.location.reload();
  };

  // --- UI ---
  return (
    <>
      {children}

      {/* Install UI (full card - first visit) */}
      {canShowInstall && (
        <div className="fixed bottom-4 left-4 right-4 z-50">
          <Card className="bg-white/95 backdrop-blur-sm border-purple-200 shadow-lg">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Download className="h-5 w-5 text-purple-600" />
                Install CinemaSync
              </CardTitle>
              <CardDescription>
                Install our app for a better experience with offline support and
                quick access.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button
                onClick={handleInstallPWA}
                className="flex-1 bg-purple-600 hover:bg-purple-700"
              >
                Install App
              </Button>
              <Button
                variant="outline"
                onClick={handleDismissInstall}
                className="px-4"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Mini Install Button (always available after first visit) */}
      {showMiniInstall && (
        <div className="fixed bottom-4 left-4 z-50">
          <Button
            onClick={handleInstallPWA}
            className="rounded-full shadow-lg bg-purple-600 hover:bg-purple-700 px-4 py-2"
          >
            <Download className="h-4 w-4 mr-1" /> Install App
          </Button>
        </div>
      )}

      {/* Update UI */}
      {showUpdatePrompt && (
        <div className="fixed bottom-4 left-4 right-4 z-50">
          <Card className="bg-white/95 border-blue-200 shadow-lg">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <RefreshCw className="h-5 w-5 text-blue-600" />
                Update Available
              </CardTitle>
              <CardDescription>
                A new version is available. Update now for the latest features.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button
                onClick={handleUpdatePWA}
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                Update Now
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowUpdatePrompt(false)}
                className="px-4"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Offline UI */}
      {!isOnline && (
        <div className="fixed top-4 left-4 right-4 z-50">
          <Card className="bg-orange-50 border-orange-200">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 text-orange-800">
                <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-medium">
                  You're offline. Some features may be limited.
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
