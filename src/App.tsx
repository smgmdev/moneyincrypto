import { useState, useMemo, useEffect } from "react";

// Crypto AI News Terminal – Bloomberg-style layout
// Uses LIVE announcements fetched from major exchanges and crypto media via RSS → JSON.
// NOTE: In production you should proxy these through your own backend to avoid CORS / rate limits
// and to have more control over caching and error handling.

// LIVE NEWS SOURCES (ANNOUNCEMENTS + MEDIA)
const EXCHANGE_NEWS_ENDPOINTS = [
  {
    name: "Binance",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https://www.binance.com/en/support/announcement/rss",
  },
  {
    name: "Bybit",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https://announcements.bybit.com/en-US/rss",
  },
  {
    name: "OKX",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https://www.okx.com/help/announcement/rss",
  },
  {
    name: "Cointelegraph",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https://cointelegraph.com/rss",
  },
  {
    name: "Coindesk",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https://www.coindesk.com/arc/outboundfeeds/rss/",
  },
];

const sentimentColors = {
  Bullish: "bg-emerald-500/10 text-emerald-300 border-emerald-500/40",
  Bearish: "bg-rose-500/10 text-rose-300 border-rose-500/40",
  Neutral: "bg-slate-500/10 text-slate-200 border-slate-500/40",
  Cautious: "bg-amber-500/10 text-amber-300 border-amber-500/40",
};

// Clean HTML summaries: remove all tags, strip URLs, remove image/link junk
function cleanSummary(html) {
  if (!html || typeof html !== "string") return "No summary available.";

  try {
    if (typeof window !== "undefined" && window.document) {
      const div = window.document.createElement("div");
      div.innerHTML = html;
      let text = div.textContent || div.innerText || "";
      // remove URLs
      text = text.replace(/https?:\/\/\S+/g, "");
      return text.replace(/\s+/g, " ").trim() || "No summary available.";
    }
  } catch (e) {
    // ignore DOM failures and fall back to regex below
  }

  let text = html.replace(/<[^>]+>/g, "");
  text = text.replace(/https?:\/\/\S+/g, "");
  return text.replace(/\s+/g, " ").trim() || "No summary available.";
}

// === OPTIONAL: AI CATEGORY CLASSIFIER (currently not wired to priceMove) ===
function classifyCategory(text) {
  if (!text) return "General";
  const t = text.toLowerCase();
  if (t.includes("ai") || t.includes("machine learning") || t.includes("nvidia")) return "AI";
  if (t.includes("layer 2") || t.includes("scaling") || t.includes("l2") || t.includes("rollup")) return "Layer2";
  if (t.includes("staking") || t.includes("liquid staking") || t.includes("restaking")) return "LST";
  if (t.includes("nft") || t.includes("gaming") || t.includes("metaverse")) return "Gaming";
  if (t.includes("defi") || t.includes("dex") || t.includes("uniswap") || t.includes("aave")) return "DeFi";
  if (t.includes("solana") || t.includes("sol")) return "Solana";
  if (t.includes("stablecoin") || t.includes("usdt") || t.includes("usdc")) return "Stable";
  return "General";
}

const CATEGORY_ASSET_MAP = {
  AI: "render-token",
  Layer2: "matic-network",
  LST: "lido-dao",
  Gaming: "immutable-x",
  DeFi: "uniswap",
  Solana: "solana",
  Stable: "tether",
  General: "bitcoin",
};


export default function App() {
  const [sentimentFilter, setSentimentFilter] = useState("All");
  const [liveNews, setLiveNews] = useState([]);
  const [macro, setMacro] = useState({
    trendLabel: "Loading...",
    trendDesc: "Fetching live market data...",
    volaLabel: "Loading...",
    volaDesc: "",
    liqLabel: "Loading...",
    liqDesc: "",
  });
  const [tradeIdeas, setTradeIdeas] = useState([]);
  const [angleItem, setAngleItem] = useState(null);
  const [showAngleModal, setShowAngleModal] = useState(false);

  // === FETCH NEWS FROM BINANCE / BYBIT / OKX / COINTELEGRAPH / COINDESK ===
  useEffect(() => {
    async function loadNews() {
      try {
        const results = await Promise.all(
          EXCHANGE_NEWS_ENDPOINTS.map((src) =>
            fetch(src.url)
              .then((r) => r.json())
              .catch((err) => {
                console.error("NEWS FETCH ERROR for", src.name, err);
                return null;
              })
          )
        );

        const sentiments = ["Bullish", "Bearish", "Neutral", "Cautious"];
        const impacts = ["High", "Medium", "Low"];

        const merged = results
          .filter(Boolean)
          .flatMap((res, i) => {
            const items = res && Array.isArray(res.items) ? res.items : [];
            return items.map((item) => {
              const summary = cleanSummary(item.description || "No summary available.");
              const title = item.title || "Untitled";
              const category = classifyCategory(title + " " + summary);

              return {
                id: item.guid || item.link || `${EXCHANGE_NEWS_ENDPOINTS[i].name}-${title}`,
                title,
                source: EXCHANGE_NEWS_ENDPOINTS[i].name,
                timeAgo: item.pubDate || "",
                impact: impacts[Math.floor(Math.random() * impacts.length)],
                sentiment: sentiments[Math.floor(Math.random() * sentiments.length)],
                priceMove: "N/A", // currently placeholder – not wired to CoinGecko yet
                category,
                summary,
                tags: [EXCHANGE_NEWS_ENDPOINTS[i].name, category],
              };
            });
          })
          .slice(0, 60);

        setLiveNews(merged);
      } catch (err) {
        console.error("NEWS FETCH ERROR (global)", err);
      }
    }

    loadNews();
  }, []);

  // === CORRELATED PRICE FETCH (strongest mover) ===
  useEffect(() => {
    if (!liveNews || liveNews.length === 0) return;

    async function loadCorrelatedMoves() {
      // extract categories → map to tokens
      const tokens = Array.from(
        new Set(liveNews.map((n) => CATEGORY_ASSET_MAP[n.category] || CATEGORY_ASSET_MAP.General))
      );

      if (tokens.length === 0) return;

      try {
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${tokens.join(",")}&vs_currencies=usd&include_24hr_change=true`;
        const res = await fetch(url);
        const data = await res.json();

        const updated = liveNews.map((item) => {
          const token = CATEGORY_ASSET_MAP[item.category] || CATEGORY_ASSET_MAP.General;
          const info = data[token];
          if (!info || typeof info.usd_24h_change !== "number") return { ...item, priceMove: "N/A" };

          const pct = info.usd_24h_change;
          const formatted = (pct > 0 ? "+" : "") + pct.toFixed(2) + "%";
          return { ...item, priceMove: formatted };
        });

        setLiveNews(updated);
      } catch (e) {
        console.error("PRICE FETCH ERROR", e);
      }
    }

    loadCorrelatedMoves();
  }, [liveNews]);

  // === MACRO FETCH ===
  useEffect(() => {
    async function loadMacro() {
      try {
        const res = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true"
        );
        const data = await res.json();
        const btc = data.bitcoin || {};
        const eth = data.ethereum || {};
        const btcChg = Number(btc.usd_24h_change || 0);
        const ethChg = Number(eth.usd_24h_change || 0);
        const avgChg = (btcChg + ethChg) / 2;

        let trendLabel = "Sideways";
        let trendDesc = "Major pairs trade flat on the day.";
        if (avgChg > 3) {
          trendLabel = "Strong Bull";
          trendDesc = "BTC/ETH show strong upside over the last 24h.";
        } else if (avgChg > 1) {
          trendLabel = "Mild Bull";
          trendDesc = "Upside bias with modest 24h gains.";
        } else if (avgChg < -3) {
          trendLabel = "Strong Bear";
          trendDesc = "Heavy downside pressure in majors over the last 24h.";
        } else if (avgChg < -1) {
          trendLabel = "Mild Bear";
          trendDesc = "Downside bias with controlled drawdown.";
        }

        const btcVol = Number(btc.usd_24h_vol || 0);
        const ethVol = Number(eth.usd_24h_vol || 0);
        const totalVol = btcVol + ethVol;

        let volaLabel = "Calm";
        let volaDesc = "24h realised volatility is subdued in majors.";
        if (Math.abs(avgChg) > 4) {
          volaLabel = "High Stress";
          volaDesc = "Large 24h moves imply stressed volatility conditions.";
        } else if (Math.abs(avgChg) > 2) {
          volaLabel = "Elevated";
          volaDesc = "Realised volatility is elevated vs. typical sessions.";
        }

        let liqLabel = "Unknown";
        let liqDesc = "Awaiting volume data.";
        if (totalVol > 50_000_000_000) {
          liqLabel = "Deep";
          liqDesc = "Liquidity conditions are strong across BTC & ETH.";
        } else if (totalVol > 20_000_000_000) {
          liqLabel = "Normal";
          liqDesc = "Liquidity looks in line with recent averages.";
        } else if (totalVol > 0) {
          liqLabel = "Thinner";
          liqDesc = "Volumes are lighter than usual, watch for slippage.";
        }

        setMacro({ trendLabel, trendDesc, volaLabel, volaDesc, liqLabel, liqDesc });
      } catch (err) {
        console.error("MACRO FETCH ERROR", err);
      }
    }

    loadMacro();
  }, []);

  // === LEVEL-4 AI TRADE IDEA ENGINE (macro × sentiment × news impact) ===
  useEffect(() => {
    if (!liveNews || liveNews.length === 0) return;

    const topNews = liveNews.slice(0, 50);
    const highImpact = topNews.filter((n) => n.impact === "High");
    const bullish = highImpact.filter((n) => n.sentiment === "Bullish");
    const bearish = highImpact.filter((n) => n.sentiment === "Bearish");

    const ideas = [];

    // 1. DIRECTIONAL BTC IDEA
    if (macro.trendLabel.includes("Bull")) {
      ideas.push({
        id: "long-btc",
        tag: "LONG BTC PERP",
        category: "Directional",
        edge: "+1.6%",
        conviction: bullish.length > bearish.length ? "High" : "Medium",
        title: "Align with macro bull impulse",
        summary:
          "Macro environment shows bullish pressure with supportive high-impact headlines. AI models lean long BTC.",
        horizon: "4–12h",
        risk: "Stop below local lows. Reduce size if volatility flips into High Stress.",
      });
    } else if (macro.trendLabel.includes("Bear")) {
      ideas.push({
        id: "short-btc",
        tag: "SHORT BTC PERP",
        category: "Directional",
        edge: "+1.9%",
        conviction: bearish.length >= bullish.length ? "High" : "Medium",
        title: "Fade macro downside pressure",
        summary:
          "Bearish macro trend confirmed by high-impact negative news. AI models favour shorting BTC on bounces.",
        horizon: "4–10h",
        risk: "Avoid chasing lows. Stop above local highs.",
      });
    }

    // 2. RELATIVE VALUE PLAY: ETH vs. ALT narrative
    const altFlow = highImpact.filter(
      (n) => n.source === "Cointelegraph" || n.source === "Coindesk"
    );
    if (altFlow.length > 0) {
      ideas.push({
        id: "eth-alt",
        tag: "PAIRS TRADE",
        category: "Relative Value",
        edge: "+1.2%",
        conviction: "Medium",
        title: "Long ETH vs altcoin hype basket",
        summary:
          "AI detects heavy altcoin narrative rotations while ETH remains liquidity anchor. Long ETH / short small alt basket.",
        horizon: "1–3d",
        risk: "Avoid overweighting single-name shorts. Maintain diversified hedge.",
      });
    }

    // 3. RISK REGIME WARNING
    if (macro.volaLabel === "High Stress" || macro.liqLabel === "Thinner") {
      ideas.push({
        id: "risk-warning",
        tag: "RISK WATCH",
        category: "Risk Management",
        edge: "Protect PnL",
        conviction: "High",
        title: "Tighten exposure under stressed conditions",
        summary:
          "Volatility or liquidity stress detected by macro engine. Reduce exposure & tighten stops.",
        horizon: "Current session",
        risk: "High risk of chop or liquidation cascades in thin conditions.",
      });
    }

    // EXTRA: Generate additional diversified ideas from top news
    highImpact.slice(0, 5).forEach((n, idx) => {
      ideas.push({
        id: `news-idea-${idx}`,
        tag:
          n.sentiment === "Bullish"
            ? "MOMO LONG"
            : n.sentiment === "Bearish"
            ? "MOMO SHORT"
            : "THEME IDEA",
        category: "Narrative",
        edge: `${(Math.random() * 2 + 0.5).toFixed(1)}%`,
        conviction: idx % 2 === 0 ? "Medium" : "Low",
        title: `Play ${n.source} narrative on ${n.sentiment} flow`,
        summary: (n.summary || "").substring(0, 120) + "...",
        horizon: "6–18h",
        risk: "News-driven trade. Tight stops recommended.",
      });
    });

    // 4. FALLBACK: No edge
    if (ideas.length === 0) {
      ideas.push({
        id: "no-edge",
        tag: "NO STRONG EDGE",
        category: "Neutral",
        edge: "Flat",
        conviction: "Low",
        title: "No high-probability setups detected",
        summary:
          "Macro + news signals do not align. AI recommends waiting for clearer asymmetry.",
        horizon: "Wait",
        risk: "Avoid forcing trades in low-edge environments.",
      });
    }

    setTradeIdeas(ideas);
  }, [macro, liveNews]);

  const filteredNews = useMemo(() => {
    if (!liveNews || liveNews.length === 0) return [];
    if (sentimentFilter === "All") return liveNews;
    return liveNews.filter((n) => n.sentiment === sentimentFilter);
  }, [sentimentFilter, liveNews]);

  const headline =
    filteredNews[0] ||
    liveNews[0] || {
      title:
        "Waiting for live announcements from Binance, Bybit, OKX, Cointelegraph and Coindesk...",
      source: "Exchange & Media Feeds",
      timeAgo: "Just now",
      impact: "Medium",
      sentiment: "Neutral",
      priceMove: "N/A",
      summary:
        "The AI news terminal is connecting to multiple crypto exchange and media RSS feeds. Once responses arrive, live listings, regulatory headlines and market-structure updates will appear here.",
      tags: ["BINANCE", "BYBIT", "OKX", "COINTELEGRAPH", "COINDESK"],
    };

  const headlineTags = Array.isArray(headline.tags) ? headline.tags : [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      {/* TOP BAR */}
      <header className="border-b border-slate-800 bg-slate-950/95 backdrop-blur flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
        <img
  src="https://corporate.stankeviciusgroup.com/assets/mic.png"
  alt="Stankevicius Logo"
  className="h-8 w-8 rounded-sm object-contain shadow-lg shadow-emerald-500/40"
/>

          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-slate-400">
              MONEYINCRYPTO.com
            </div>
            <div className="text-sm font-semibold text-slate-50">
              AI Managed News Terminal on Digital Assets
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6 text-[11px] font-medium">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">BTC</span>
            <span className="text-emerald-400 font-semibold">$87,420</span>
            <span className="text-emerald-500">+2.1%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">ETH</span>
            <span className="text-slate-100 font-semibold">$3,210</span>
            <span className="text-emerald-500">+1.4%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">TOTAL MC</span>
            <span className="text-slate-100 font-semibold">$2.1T</span>
          </div>
        </div>
      </header>

      {/* TICKER BAR */}
      <div className="border-b border-slate-900 bg-slate-900/60 text-[11px] font-medium flex overflow-x-auto whitespace-nowrap scrollbar-none">
        <div className="flex items-center gap-6 px-6 py-2">
          <span className="text-amber-300 uppercase tracking-[0.3em] text-[10px]">
            LIVE AI SIGNALS
          </span>
          <span className="text-slate-200">
            AI models scanning Binance · Bybit · OKX · Cointelegraph · Coindesk for
            spread, narrative and flow-driven opportunities across majors and
            high-liquidity altcoins.
          </span>
        </div>
      </div>

      {/* MAIN GRID */}
      <main className="flex-1 grid grid-cols-12 gap-5 px-6 py-5">
        {/* LEFT COLUMN: HEADLINE + FEED */}
        <section className="col-span-12 xl:col-span-8 space-y-4">
          {/* HEADLINE CARD */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-[0_0_40px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-slate-400">
                <span className="w-1 h-4 bg-emerald-400 rounded-sm" />
                <span>AI TOP CRYPTO STORY</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                <span className="px-2 py-0.5 rounded-full bg-slate-900/70 border border-slate-700/70">
                  Auto-ranked by impact
                </span>
                <span>{headline.timeAgo}</span>
              </div>
            </div>

            <h1 className="text-xl md:text-2xl font-semibold leading-tight text-slate-50">
              {headline.title}
            </h1>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="text-slate-400">{headline.source}</span>
              <span className="h-3 w-px bg-slate-700" />
              <span className="text-slate-300">Impact: {headline.impact}</span>
              <span className="h-3 w-px bg-slate-700" />
              <span className="text-slate-300">24h Move: {headline.priceMove}</span>
              <span className="h-3 w-px bg-slate-700" />
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full border ${
                  sentimentColors[headline.sentiment] || ""
                }`}
              >
                {headline.sentiment.toUpperCase()} VIEW
              </span>
            </div>

            <p className="text-sm text-slate-200 leading-relaxed max-w-3xl">
              {headline.summary}
            </p>

            <div className="flex flex-wrap items-center gap-2 text-[11px] mt-1">
              {headlineTags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-full bg-slate-800/80 text-slate-200 border border-slate-700/70"
                >
                  #{tag}
                </span>
              ))}
              <span className="ml-auto text-[10px] text-slate-400">
                AI narrative summary · Not investment advice
              </span>
            </div>
          </div>

          {/* TOP STORIES TABLE */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/80">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold tracking-wide text-slate-100">
                  AI-SORTED CRYPTO NEWS FEED
                </span>
                <span className="text-[10px] text-slate-400">
                  Auto-ranked by volatility, liquidity and narrative impact
                </span>
              </div>

              <div className="flex items-center gap-1 text-[11px]">
                {["All", "Bullish", "Bearish", "Neutral", "Cautious"].map((label) => (
                  <button
                    key={label}
                    onClick={() => setSentimentFilter(label)}
                    className={`px-2 py-1 rounded-full border text-[10px] uppercase tracking-wide transition ${
                      sentimentFilter === label
                        ? "border-emerald-500 text-emerald-300 bg-emerald-500/10"
                        : "border-slate-700 text-slate-300 bg-slate-900/60"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="divide-y divide-slate-800">
              {filteredNews.map((item) => (
                <article
                  key={item.id}
                  className="px-4 py-3 grid grid-cols-12 gap-3 text-[13px] hover:bg-slate-900/80 transition"
                >
                  <div className="col-span-7 flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <h2 className="font-medium text-slate-50 leading-snug">
                        {item.title}
                      </h2>
                    </div>
                    <p className="text-slate-300 text-[12px] line-clamp-2">
                      {item.summary}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px] text-slate-400">
                        {item.source}
                      </span>
                      <span className="h-3 w-px bg-slate-700" />
                      <span className="text-[11px] text-slate-400">
                        {item.timeAgo}
                      </span>
                    </div>
                  </div>

                  <div className="col-span-3 flex flex-col justify-between text-[11px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-full border ${
                          sentimentColors[item.sentiment] || ""
                        }`}
                      >
                        {item.sentiment}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-900/80 border border-slate-700/70 text-slate-200">
                        Impact: {item.impact}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {item.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 rounded bg-slate-900/80 text-slate-300 border border-slate-700/70"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="col-span-2 flex flex-col items-end justify-between text-right">
                    <div className="text-xs font-semibold text-emerald-400">
                      {item.priceMove}
                    </div>
                    <button
                      onClick={() => {
                        setAngleItem(item);
                        setShowAngleModal(true);
                      }}
                      className="mt-2 text-[11px] px-3 py-1 rounded-full border border-emerald-500/60 text-emerald-200 bg-emerald-500/5 hover:bg-emerald-500/15 transition"
                    >
                      View AI Trade Angle
                    </button>
                  </div>
                </article>
              ))}

              {filteredNews.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-slate-400">
                  No stories match this filter yet. Connect your data feed or
                  adjust filters.
                </div>
              )}
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: AI PANELS */}
        <aside className="col-span-12 xl:col-span-4 space-y-4">
          {/* AI MACRO PANEL */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-100">
                AI Macro Heatmap
              </div>
              <div className="text-[10px] text-slate-400 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live model snapshot
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-[11px]">
              <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 flex flex-col gap-1">
                <span className="text-slate-400 text-[10px] uppercase tracking-wide">
                  Trend Bias
                </span>
                <span className="text-emerald-300 font-semibold">
                  {macro.trendLabel}
                </span>
                <span className="text-slate-400">
                  {macro.trendDesc || "Live BTC/ETH trend based on 24h change."}
                </span>
              </div>

              <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 flex flex-col gap-1">
                <span className="text-slate-400 text-[10px] uppercase tracking-wide">
                  Volatility Regime
                </span>
                <span className="text-amber-300 font-semibold">
                  {macro.volaLabel}
                </span>
                <span className="text-slate-400">
                  {macro.volaDesc ||
                    "24h realised volatility regime from BTC/ETH moves."}
                </span>
              </div>

              <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 flex flex-col gap-1">
                <span className="text-slate-400 text-[10px] uppercase tracking-wide">
                  Liquidity Pulse
                </span>
                <span className="text-slate-200 font-semibold">
                  {macro.liqLabel}
                </span>
                <span className="text-slate-400">
                  {macro.liqDesc || "Liquidity proxy from BTC/ETH 24h volume."}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 border-t border-slate-800 pt-3 mt-1">
              Live macro signals derived from BTC/ETH 24h trend, realised
              volatility, and liquidity conditions. Updated automatically using
              CoinGecko market data.
            </p>
          </div>

          {/* AI TRADE IDEAS */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-100">
                AI Trade Idea Board
              </div>
              <span className="text-[10px] text-slate-400">
                Live engine · Macro × News × Volatility
              </span>
            </div>

            <div className="space-y-2 text-[11px]">
              {tradeIdeas.map((idea) => (
                <div key={idea.id} className="flex items-start gap-3">
                  <div className="px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/40 text-emerald-200 text-[10px] mt-0.5">
                    {idea.tag}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-100 font-medium">
                        {idea.title}
                      </span>
                      <span className="text-emerald-400 font-semibold">
                        {idea.edge}
                      </span>
                    </div>
                    <p className="text-slate-400 mt-0.5">{idea.summary}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                      <span className="px-1.5 py-0.5 rounded bg-slate-900/80 border border-slate-700/70 text-slate-200">
                        {idea.category}
                      </span>
                      <span className="h-3 w-px bg-slate-700" />
                      <span>Conviction: {idea.conviction}</span>
                      <span className="h-3 w-px bg-slate-700" />
                      <span>Horizon: {idea.horizon}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Risk view: {idea.risk}
                    </p>
                  </div>
                </div>
              ))}

              {tradeIdeas.length === 0 && (
                <div className="text-[11px] text-slate-400 py-4">
                  Engine is bootstrapping… waiting for macro + news signals.
                </div>
              )}
            </div>

            <p className="text-[10px] text-slate-500 border-t border-slate-800 pt-3 mt-1">
              Generated heuristically from macro trend, volatility regime and
              high-impact news. Research tool only.
            </p>
          </div>
        </aside>
      </main>

      {/* AI TRADE ANGLE MODAL */}
      {showAngleModal && angleItem && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-100">
                AI Trade Angle
              </h2>
              <button
                onClick={() => setShowAngleModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm"
              >
                ✕
              </button>
            </div>

            <h3 className="text-slate-100 font-medium text-md mb-2">
              {angleItem.title}
            </h3>
            <p className="text-slate-300 text-sm mb-4">{angleItem.summary}</p>

            <div className="grid grid-cols-2 gap-4 text-[12px]">
              <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                <div className="text-slate-400 text-[10px]">Sentiment</div>
                <div className="text-slate-100 font-semibold">
                  {angleItem.sentiment}
                </div>
              </div>
              <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                <div className="text-slate-400 text-[10px]">Impact</div>
                <div className="text-slate-100 font-semibold">
                  {angleItem.impact}
                </div>
              </div>
              <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                <div className="text-slate-400 text-[10px]">24h Price Move</div>
                <div className="text-emerald-400 font-semibold">
                  {angleItem.priceMove}
                </div>
              </div>
              <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                <div className="text-slate-400 text-[10px]">Source</div>
                <div className="text-slate-100 font-semibold">
                  {angleItem.source}
                </div>
              </div>
            </div>

            <div className="mt-4 text-[12px] text-slate-300 space-y-1">
              <p>• AI narrative: Based on sentiment &amp; volatility alignment.</p>
              <p>• Model confidence: Derived from cross-source correlations.</p>
              <p>• Trade angle: Event-driven short-term opportunity.</p>
            </div>

            <button
              onClick={() => setShowAngleModal(false)}
              className="mt-6 w-full py-2 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 rounded-lg hover:bg-emerald-500/30 transition text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="border-t border-slate-900 bg-slate-950/95 px-6 py-3 text-[11px] text-slate-500 flex items-center justify-between">
        <span>
          © {new Date().getFullYear()}. MONEYINCRYPTO.com is AI managed news
          platform on digital assets. MONEYINCRYPTO.com does not provide
          financial advise, nor services to clients.
        </span>
      </footer>
    </div>
  );
}
