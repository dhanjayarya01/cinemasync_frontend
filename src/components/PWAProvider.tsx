"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, Download, X } from "lucide-react";

export function PWAProvider({ children }: { children: React.ReactNode }) {
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const pathname = usePathname();

  
  const shouldShowInstallPrompt =
    pathname === "/" &&
    deferredPrompt !== null &&
    !isInstalled &&
    localStorage.getItem("pwa-install-dismissed") !== "true";

  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkIfInstalled = () => {
      if (window.matchMedia("(display-mode: standalone)").matches) {
        setIsInstalled(true);
      }
    };

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
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
                }
              });
            }
          });
        } catch (error) {
          console.error("Service Worker registration failed:", error);
        }
      }
    };

    checkIfInstalled();
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
    };
  }, []);

  // ✅ Reset prompt when leaving landing page
  useEffect(() => {
    if (pathname !== "/") {
      setDeferredPrompt(null);
    }
  }, [pathname]);

  const handleInstallPWA = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        localStorage.removeItem("pwa-install-dismissed");
      }
      setDeferredPrompt(null);
    }
  };

  const handleDismissInstall = () => {
    setDeferredPrompt(null);
    localStorage.setItem("pwa-install-dismissed", "true");
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

  return (
    <>
      {children}

      {/* Install PWA Prompt - strictly only on landing page */}
      {shouldShowInstallPrompt && (
        <div className="fixed bottom-4 left-4 right-4 z-50">
          <Card className="bg-white/95 backdrop-blur-sm border-purple-200 shadow-lg">
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
              <Button onClick={handleInstallPWA} className="flex-1 bg-purple-600 hover:bg-purple-700">
                Install App
              </Button>
              <Button variant="outline" onClick={handleDismissInstall} className="px-4">
                <X className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Update PWA Prompt */}
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

      {/* Offline Indicator */}
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
