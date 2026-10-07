      try {
        const search = new URLSearchParams(window.location.search)
        const privacy = search.get('privacy')
        if (privacy) {
          loadPrivacy()
        }
      } catch (error) {}
