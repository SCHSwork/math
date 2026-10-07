      if ("serviceWorker" in navigator && location.protocol === "https:") {
        navigator.serviceWorker.register(new URL("sw.js", location.href).href, { scope: new URL("./", location.href).href })
          .catch(err => console.warn("Service worker not installed:", err));
      }
