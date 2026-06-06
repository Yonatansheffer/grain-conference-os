async function verifyScoutCandidateSource(value, event, fetchImpl = fetch) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch (error) {
    return { live: false, datesConfirmed: false };
  }
  if (url.protocol !== "https:" || !url.hostname.includes(".")) {
    return { live: false, datesConfirmed: false };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    let response = await fetchImpl(url.href, {
      method: "HEAD",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal
    });
    if (response.status === 405 || response.status === 501) {
      response = await fetchImpl(url.href, {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal
      });
    }
    if (!response.ok) return { live: false, datesConfirmed: false };
    const finalUrl = new URL(response.url || url.href);
    if (finalUrl.protocol !== "https:" || /(?:^|\/)(?:404|not-found|error)(?:\/|$)/i.test(finalUrl.pathname)) {
      return { live: false, datesConfirmed: false };
    }
    return {
      live: true,
      datesConfirmed: event.dateConfirmed !== false && event.tentative !== true
    };
  } catch (error) {
    return { live: false, datesConfirmed: false };
  } finally {
    clearTimeout(timeout);
  }
}
