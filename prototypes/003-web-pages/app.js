(function () {
  const cardAssets = {
    oda: {
      name: "織田信長",
      thumbnail: "https://eiketsudb.com/wp-content/uploads/oda-nobunaga-st-eiketsu-taisen-thumbnail-768x432.jpg",
      icon: "https://eiketsudb.com/wp-content/uploads/icon-oda-nobunaga-st.webp"
    },
    sakamoto: {
      name: "坂本龍馬",
      thumbnail: "https://eiketsudb.com/wp-content/uploads/sakamoto-ryouma-eiketsu-taisen-thumbnail-768x432.jpg",
      icon: "https://eiketsudb.com/wp-content/uploads/icon-sakamoto-ryouma.webp"
    },
    tokugawa: {
      name: "徳川家康",
      thumbnail: "https://eiketsudb.com/wp-content/uploads/tokugawa-ieyasu-eiketsu-taisen-thumbnail-768x432.jpg",
      icon: "https://eiketsudb.com/wp-content/uploads/icon-tokugawa-ieyasu.webp"
    },
    uesugi: {
      name: "上杉謙信",
      thumbnail: "https://eiketsudb.com/wp-content/uploads/uesugi-kenshin-eiketsu-taisen-thumbnail-768x432.jpg",
      icon: "https://eiketsudb.com/wp-content/uploads/icon-uesugi-kenshin.webp"
    },
    takeda: {
      name: "武田信玄",
      thumbnail: "https://eiketsudb.com/wp-content/uploads/takeda-shingen-eiketsu-taisen-thumbnail-768x432.jpg",
      icon: "https://eiketsudb.com/wp-content/uploads/icon-takeda-shingen.webp"
    },
    shibata: {
      name: "柴田勝家",
      thumbnail: "https://eiketsudb.com/wp-content/uploads/shibata-katsuie-eiketsu-taisen-thumbnail-768x432.jpg",
      icon: "https://eiketsudb.com/wp-content/uploads/icon-shibata-katsuie.webp"
    },
    zhangFei: {
      name: "張飛",
      thumbnail: "https://eiketsudb.com/wp-content/uploads/zhang-fei-eiketsu-taisen-thumbnail-160x90.jpg",
      icon: "https://eiketsudb.com/wp-content/uploads/icon-zhang-fei.webp"
    },
    sanada: {
      name: "真田幸村",
      icon: "https://eiketsudb.com/wp-content/uploads/icon-sanada-yukimura.webp"
    },
    xunYu: {
      name: "荀彧",
      icon: "https://eiketsudb.com/wp-content/uploads/icon-xun-yu.webp"
    },
    zhangChunhua: {
      name: "張春華",
      icon: "https://eiketsudb.com/wp-content/uploads/icon-zhang-chunhua.webp"
    },
    kobayakawa: {
      name: "小早川秀包",
      icon: "https://eiketsudb.com/wp-content/uploads/icon-kobayakawa-hidekane.webp"
    },
    philippa: {
      name: "フィリッパ",
      icon: "https://eiketsudb.com/wp-content/uploads/icon-philippa-of-hainault-ex.webp"
    }
  };

  const homeData = {
    updatedAt: "2026-05-23 08:40",
    heroImageUrl: cardAssets.oda.icon,
    heroImageAlt: "織田信長 卡牌头像",
    heroArt: [
      cardAssets.oda,
      cardAssets.sakamoto,
      cardAssets.tokugawa,
      cardAssets.uesugi,
      cardAssets.takeda,
      cardAssets.shibata
    ],
    factionShare: [
      {
        faction: "蒼",
        share: 29,
        color: "#1e3ca0",
        imageUrl: cardAssets.oda.icon,
        imageAlt: "蒼势力样例：織田信長",
        representatives: ["織田信長 号令", "坂本龍馬 蒼鉄砲"]
      },
      {
        faction: "碧",
        share: 22,
        color: "#007332",
        imageUrl: cardAssets.tokugawa.icon,
        imageAlt: "碧势力样例：徳川家康",
        representatives: ["徳川家康 采配", "碧バランス"]
      },
      {
        faction: "玄",
        share: 18,
        color: "#636261",
        imageUrl: cardAssets.uesugi.icon,
        imageAlt: "玄势力样例：上杉謙信",
        representatives: ["上杉謙信 毘沙門天", "玄騎馬バランス"]
      },
      {
        faction: "緋",
        share: 17,
        color: "#b4191b",
        imageUrl: cardAssets.takeda.icon,
        imageAlt: "緋势力样例：武田信玄",
        representatives: ["武田信玄 風林火山", "緋号令"]
      },
      {
        faction: "琥",
        share: 14,
        color: "#ff7800",
        imageUrl: cardAssets.zhangFei.icon,
        imageAlt: "琥势力静态样例卡图",
        representatives: ["張飛 高武力槍", "琥混色"]
      }
    ],
    representativeDecks: [
      {
        faction: "蒼",
        deckName: "織田信長 号令",
        rankScore: 96,
        winRate: 54.2,
        usageRate: 18.6,
        imageUrl: cardAssets.oda.icon,
        imageUrls: [cardAssets.oda.icon, cardAssets.shibata.icon, cardAssets.sakamoto.icon],
        deckCards: [cardAssets.oda, cardAssets.shibata, cardAssets.sakamoto, cardAssets.xunYu, cardAssets.kobayakawa, cardAssets.philippa, cardAssets.sanada, cardAssets.zhangChunhua],
        imageAlt: "織田信長号令样例卡组"
      },
      {
        faction: "蒼",
        deckName: "坂本龍馬 蒼鉄砲",
        rankScore: 92,
        winRate: 53.7,
        usageRate: 15.8,
        imageUrl: cardAssets.sakamoto.icon,
        imageUrls: [cardAssets.sakamoto.icon, cardAssets.oda.icon, cardAssets.shibata.icon],
        deckCards: [cardAssets.sakamoto, cardAssets.oda, cardAssets.shibata, cardAssets.tokugawa, cardAssets.xunYu, cardAssets.zhangChunhua, cardAssets.kobayakawa, cardAssets.philippa],
        imageAlt: "坂本龍馬蒼鉄砲样例卡组"
      },
      {
        faction: "碧",
        deckName: "徳川家康 采配",
        rankScore: 89,
        winRate: 55.1,
        usageRate: 11.9,
        imageUrl: cardAssets.tokugawa.icon,
        imageUrls: [cardAssets.tokugawa.icon, cardAssets.sakamoto.icon, cardAssets.oda.icon],
        deckCards: [cardAssets.tokugawa, cardAssets.sakamoto, cardAssets.oda, cardAssets.philippa, cardAssets.kobayakawa, cardAssets.zhangFei, cardAssets.xunYu, cardAssets.zhangChunhua],
        imageAlt: "徳川家康采配样例卡组"
      },
      {
        faction: "玄",
        deckName: "上杉謙信 毘沙門天",
        rankScore: 86,
        winRate: 52.9,
        usageRate: 9.4,
        imageUrl: cardAssets.uesugi.icon,
        imageUrls: [cardAssets.uesugi.icon, cardAssets.takeda.icon, cardAssets.shibata.icon],
        deckCards: [cardAssets.uesugi, cardAssets.takeda, cardAssets.shibata, cardAssets.sanada, cardAssets.zhangChunhua, cardAssets.xunYu, cardAssets.sakamoto, cardAssets.kobayakawa],
        imageAlt: "上杉謙信毘沙門天样例卡组"
      }
    ],
    featuredCards: [
      {
        name: "織田信長",
        usageRate: 18.6,
        winRate: 54.2,
        rankScore: 96,
        imageUrl: cardAssets.oda.icon,
        imageAlt: "織田信長"
      },
      {
        name: "坂本龍馬",
        usageRate: 15.8,
        winRate: 53.7,
        rankScore: 92,
        imageUrl: cardAssets.sakamoto.icon,
        imageAlt: "坂本龍馬"
      },
      {
        name: "徳川家康",
        usageRate: 11.9,
        winRate: 55.1,
        rankScore: 89,
        imageUrl: cardAssets.tokugawa.icon,
        imageAlt: "徳川家康"
      },
      {
        name: "武田信玄",
        usageRate: 9.4,
        winRate: 52.6,
        rankScore: 83,
        imageUrl: cardAssets.takeda.icon,
        imageAlt: "武田信玄"
      }
    ]
  };

  const tierRows = [
    {
      deckId: "sample-oda-command",
      deckName: "織田信長 号令",
      categoryId: "oda-command",
      categoryName: "Oda Command",
      faction: "蒼",
      namingSource: "single",
      rankScore: 96,
      winRate: 54.2,
      usageRate: 18.6,
      kabukiPoints: 28,
      sampleSize: 1480,
      imageUrl: cardAssets.oda.icon,
      imageAlt: "織田信長"
    },
    {
      deckId: "sample-ryoma-gunline",
      deckName: "坂本龍馬 蒼鉄砲",
      categoryId: "blue-gunline",
      categoryName: "Blue Gunline",
      faction: "蒼",
      namingSource: "single",
      rankScore: 92,
      winRate: 53.7,
      usageRate: 15.8,
      kabukiPoints: 34,
      sampleSize: 1320,
      imageUrl: cardAssets.sakamoto.icon,
      imageAlt: "坂本龍馬"
    },
    {
      deckId: "sample-ieyasu-command",
      deckName: "徳川家康 采配",
      categoryId: "green-command",
      categoryName: "Green Command",
      faction: "碧",
      namingSource: "type",
      rankScore: 89,
      winRate: 55.1,
      usageRate: 11.9,
      kabukiPoints: 41,
      sampleSize: 860,
      imageUrl: cardAssets.tokugawa.icon,
      imageAlt: "徳川家康"
    },
    {
      deckId: "sample-oda-shibata",
      deckName: "織田信長 + 柴田勝家",
      categoryId: "oda-tempo",
      categoryName: "Oda Tempo",
      faction: "蒼",
      namingSource: "combo",
      rankScore: 87,
      winRate: 53.4,
      usageRate: 10.6,
      kabukiPoints: 35,
      sampleSize: 810,
      imageUrl: cardAssets.shibata.icon,
      imageAlt: "柴田勝家"
    },
    {
      deckId: "sample-uesugi-cavalry",
      deckName: "上杉謙信 毘沙門天",
      categoryId: "black-cavalry",
      categoryName: "Black Cavalry",
      faction: "玄",
      namingSource: "single",
      rankScore: 86,
      winRate: 52.9,
      usageRate: 10.8,
      kabukiPoints: 36,
      sampleSize: 790,
      imageUrl: cardAssets.uesugi.icon,
      imageAlt: "上杉謙信"
    },
    {
      deckId: "sample-takeda-command",
      deckName: "武田信玄 風林火山",
      categoryId: "red-command",
      categoryName: "Red Command",
      faction: "緋",
      namingSource: "single",
      rankScore: 81,
      winRate: 52.4,
      usageRate: 8.7,
      kabukiPoints: 45,
      sampleSize: 620,
      imageUrl: cardAssets.takeda.icon,
      imageAlt: "武田信玄"
    },
    {
      deckId: "sample-zhangfei-spear",
      deckName: "張飛 高武力槍",
      categoryId: "amber-spear",
      categoryName: "Amber Spear",
      faction: "琥",
      namingSource: "type",
      rankScore: 73,
      winRate: 50.9,
      usageRate: 6.5,
      kabukiPoints: 52,
      sampleSize: 410,
      imageUrl: cardAssets.zhangFei.icon,
      imageAlt: "張飛"
    }
  ];

  const sourceLabels = {
    single: "单卡",
    combo: "组合",
    type: "类型"
  };

  const sortLabels = {
    rankScore: "综合Rank",
    winRate: "胜率",
    usageRate: "使用率",
    kabukiPoints: "倾奇点",
    sampleSize: "样本数"
  };

  function percent(value) {
    return `${value.toFixed(1)}%`;
  }

  function formatNumber(value) {
    return value.toLocaleString("zh-CN");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function imageMarkup(src, alt, className) {
    return `
      <span class="image-frame ${className}">
        <img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" data-image-frame>
        <span class="image-fallback">${escapeHtml(alt)}</span>
      </span>
    `;
  }

  function imageStackMarkup(urls, alt) {
    return `
      <div class="deck-image-stack" aria-label="${escapeHtml(alt)}">
        ${urls.map((url) => imageMarkup(url, alt, "stack-thumb")).join("")}
      </div>
    `;
  }

  function topShareTotal(items, count) {
    return items.slice(0, count).reduce((sum, item) => sum + item.share, 0);
  }

  function periodLabel(updatedAt) {
    const [dateText] = String(updatedAt).split(" ");
    const [year, month, day] = dateText.split("-").map(Number);
    if (!year || !month || !day) {
      return "统计区间";
    }

    const range = day <= 10 ? "上旬" : day <= 20 ? "中旬" : "下旬";
    return `${year}年${month}月${range}`;
  }

  function displayFactionLabel(faction) {
    return faction;
  }

  function topFactionSummary(items, count) {
    return items
      .slice(0, count)
      .map((item) => `${displayFactionLabel(item.faction)} ${item.share}%`)
      .join(" / ");
  }

  function factionStackedShareMarkup(items) {
    const topShare = topShareTotal(items, 3);
    return `
      <div class="stacked-share-card" aria-label="势力占比横向堆叠条">
        <div class="stacked-share-topline">
          <span>Top3 合计</span>
          <strong>${topShare}%</strong>
        </div>
        <div class="stacked-share-bar">
          ${items.map((item) => `
            <span class="share-segment" style="width:${item.share}%; --segment-color:${escapeHtml(item.color)}">
              <b>${escapeHtml(displayFactionLabel(item.faction))}</b>
              <strong>${item.share}%</strong>
            </span>
          `).join("")}
        </div>
        <div class="stacked-share-scale" aria-hidden="true">
          <span>0%</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>100%</span>
        </div>
        <div class="stacked-share-notes">
          ${items.map((item) => `
            <span style="--note-color:${escapeHtml(item.color)}"><b>${escapeHtml(displayFactionLabel(item.faction))}</b>${item.representatives.map(escapeHtml).join(" / ")}</span>
          `).join("")}
        </div>
      </div>
    `;
  }

  function featuredMetricTags(card) {
    const tags = [];
    if (card.rankScore >= 90) {
      tags.push("综合Rank高");
    }
    if (card.usageRate >= 15) {
      tags.push("使用率高");
    }
    if (card.winRate >= 54) {
      tags.push("胜率高");
    }
    if (card.usageRate >= 9) {
      tags.push("构筑常客");
    }
    if (tags.length === 0) {
      tags.push("综合观察");
    }
    return tags;
  }

  function sparklineMarkup(card, index) {
    const trendMap = [
      "4,30 18,24 32,22 46,15 60,10 74,8",
      "4,28 18,26 32,19 46,17 60,13 74,12",
      "4,32 18,25 32,28 46,19 60,18 74,11",
      "4,30 18,31 32,26 46,24 60,20 74,18"
    ];
    const points = trendMap[index % trendMap.length];
    return `
      <svg class="sparkline" viewBox="0 0 78 36" role="img" aria-label="${escapeHtml(card.name)} 综合 Rank 趋势">
        <polyline points="${points}"></polyline>
      </svg>
    `;
  }

  function metricEvidenceMarkup(card) {
    return `
      <div class="metric-evidence">
        ${featuredMetricTags(card).map((tag) => `<span class="metric-tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
    `;
  }

  function deckEvidenceTags(item) {
    const tags = [
      `综合 Rank ${item.rankScore}`,
      `胜率 ${percent(item.winRate)}`,
      `使用率 ${percent(item.usageRate)}`
    ];

    if (typeof item.sampleSize === "number") {
      tags.push(`样本 ${formatNumber(item.sampleSize)}`);
    }

    return tags;
  }

  function deckEvidenceMarkup(item, className = "deck-evidence") {
    return `
      <div class="${className}">
        ${deckEvidenceTags(item).map((tag) => `<span class="metric-tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
    `;
  }

  function deckCardsMarkup(cards, alt) {
    return `
      <div class="deck-card-strip" aria-label="${escapeHtml(alt)}">
        <span class="deck-strip-label">核心构成</span>
        <div class="deck-card-slots">
          ${cards.map((card) => `
            <span class="deck-card-slot" title="${escapeHtml(card.name)}">
              ${imageMarkup(card.icon, card.name, "deck-slot-image")}
            </span>
          `).join("")}
        </div>
      </div>
    `;
  }

  function wireImageFallbacks(root) {
    root.querySelectorAll("[data-image-frame]").forEach((image) => {
      image.addEventListener("error", () => {
        const frame = image.closest(".image-frame");
        if (frame) {
          frame.classList.add("is-broken");
        }
        image.remove();
      }, { once: true });
    });
  }

  function renderHome() {
    const heroImage = document.querySelector("[data-hero-image]");
    const heroTitle = document.querySelector('[data-field="hero-title"]');
    const heroLead = document.querySelector('[data-field="hero-lead"]');
    const dominantFactions = document.querySelector('[data-field="dominant-factions"]');
    const heroDeck = document.querySelector('[data-field="hero-deck"]');
    const heroDeckList = document.querySelector('[data-list="hero-decks"]');
    const shareSummary = document.querySelector('[data-list="faction-share"]');
    const deckList = document.querySelector('[data-list="representative-decks"]');
    const cardList = document.querySelector('[data-list="featured-cards"]');
    const featuredCardList = document.querySelector('[data-list="featured-card-list"]');

    if (heroImage) {
      heroImage.src = homeData.heroImageUrl;
      heroImage.alt = homeData.heroImageAlt;
      heroImage.addEventListener("error", () => {
        heroImage.closest(".hero-visual").classList.add("is-broken");
        heroImage.remove();
      }, { once: true });
    }

    if (heroLead) {
      heroLead.textContent = `前三势力合计 ${topShareTotal(homeData.factionShare, 3)}%，Top 3 卡组按综合 Rank 自动排序。`;
    }

    if (heroTitle) {
      heroTitle.innerHTML = `环境榜单<br><span>${escapeHtml(periodLabel(homeData.updatedAt))} 数据概览</span>`;
    }

    if (dominantFactions) {
      dominantFactions.textContent = topFactionSummary(homeData.factionShare, 3);
    }

    if (heroDeck) {
      const deck = tierRows[0];
      heroDeck.innerHTML = `
        <div class="hero-deck-media">
          ${imageMarkup(homeData.heroImageUrl, homeData.heroImageAlt, "hero-deck-image")}
        </div>
        <div class="hero-deck-copy">
          <span class="deck-label">当前第一</span>
          <strong>${escapeHtml(deck.deckName)}</strong>
          ${deckEvidenceMarkup(deck, "deck-evidence hero-evidence")}
          <div class="hero-deck-metrics">
            <span><b>${deck.rankScore}</b>综合 Rank</span>
            <span><b>${percent(deck.winRate)}</b>胜率</span>
            <span><b>${percent(deck.usageRate)}</b>使用率</span>
          </div>
        </div>
      `;
    }

    if (heroDeckList) {
      heroDeckList.innerHTML = tierRows.slice(0, 3).map((deck, index) => `
        <li class="with-art top-deck-row">
          <span class="rank">#${index + 1}</span>
          ${imageMarkup(deck.imageUrl, deck.imageAlt, "mini-thumb")}
          <div>
            <strong>${escapeHtml(deck.deckName)}</strong>
            <span>${escapeHtml(deck.faction)} / ${sourceLabels[deck.namingSource]} / 胜率 ${percent(deck.winRate)}</span>
          </div>
          <b>${deck.rankScore}</b>
        </li>
      `).join("");
    }

    if (shareSummary) {
      shareSummary.hidden = false;
      shareSummary.innerHTML = factionStackedShareMarkup(homeData.factionShare);
    }

    if (deckList) {
      deckList.innerHTML = homeData.representativeDecks.map((deck, index) => `
        <article class="deck-rank-row">
          <span class="rank">#${index + 1}</span>
          <div class="deck-cover">
            ${imageMarkup(deck.imageUrl, deck.imageAlt, "deck-cover-image")}
          </div>
          <div class="deck-main">
            <span class="faction-pill">${escapeHtml(deck.faction)}</span>
            <strong>${escapeHtml(deck.deckName)}</strong>
            ${deckEvidenceMarkup(deck)}
          </div>
          ${deckCardsMarkup(deck.deckCards, `${deck.imageAlt}卡组构成`)}
          <div class="deck-metrics">
            <span class="metric-chip"><span>胜率</span><b>${percent(deck.winRate)}</b></span>
            <span class="metric-chip"><span>使用率</span><b>${percent(deck.usageRate)}</b></span>
          </div>
          <a class="detail-link" href="./tier-list/">查看构筑</a>
        </article>
      `).join("");
    }

    if (cardList) {
      cardList.innerHTML = homeData.featuredCards.map((card, index) => `
        <tr>
          <td class="rank-cell">#${index + 1}</td>
          <td>${imageMarkup(card.imageUrl, card.imageAlt, "table-thumb")}</td>
          <td><strong>${escapeHtml(card.name)}</strong><span class="row-note">综合 Rank ${card.rankScore}</span></td>
          <td>${percent(card.usageRate)}</td>
          <td>${percent(card.winRate)}</td>
          <td>${sparklineMarkup(card, index)}</td>
          <td>${metricEvidenceMarkup(card)}</td>
        </tr>
      `).join("");
    }

    if (featuredCardList) {
      featuredCardList.innerHTML = homeData.featuredCards.map((card, index) => `
        <article class="featured-card-row">
          <span class="rank-cell">#${index + 1}</span>
          ${imageMarkup(card.imageUrl, card.imageAlt, "featured-card-image")}
          <div class="featured-card-main">
            <strong>${escapeHtml(card.name)}</strong>
            ${sparklineMarkup(card, index)}
            ${metricEvidenceMarkup(card)}
          </div>
          <div class="featured-card-metrics">
            <span><b>${card.rankScore}</b>Rank</span>
            <span><b>${percent(card.usageRate)}</b>使用率</span>
            <span><b>${percent(card.winRate)}</b>胜率</span>
          </div>
        </article>
      `).join("");
    }

    wireImageFallbacks(document);
    setupHomeStates();
  }

  function setupHomeStates() {
    const buttons = document.querySelectorAll("[data-home-state]");
    const dataContent = document.querySelector(".data-content");
    const loadingPanel = document.querySelector(".loading-panel");
    const emptyPanel = document.querySelector(".empty-panel");
    const updatedAt = document.querySelector('[data-field="updated-at"]');

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const state = button.dataset.homeState;
        buttons.forEach((item) => item.classList.toggle("is-active", item === button));

        loadingPanel.hidden = true;
        emptyPanel.hidden = state !== "empty";
        dataContent.hidden = state === "empty";

        if (state === "missing-builds") {
          updatedAt.textContent = "缺乏新构筑";
          updatedAt.classList.add("is-missing");
        } else if (state === "heated") {
          updatedAt.textContent = `${homeData.updatedAt} / 过热观察`;
          updatedAt.classList.add("is-missing");
        } else {
          updatedAt.textContent = homeData.updatedAt;
          updatedAt.classList.remove("is-missing");
        }
      });
    });
  }

  function renderTierList() {
    const factionFilter = document.getElementById("faction-filter");
    const sourceFilter = document.getElementById("source-filter");
    const sortFilter = document.getElementById("sort-filter");
    const tbody = document.querySelector('[data-list="tier-rows"]');
    const cards = document.querySelector('[data-list="tier-cards"]');
    const summary = document.querySelector('[data-field="table-summary"]');
    const detailCopy = document.querySelector('[data-field="detail-copy"]');

    const factions = Array.from(new Set(tierRows.map((row) => row.faction)));
    factions.forEach((faction) => {
      const option = document.createElement("option");
      option.value = faction;
      option.textContent = faction;
      factionFilter.appendChild(option);
    });

    function sortedRows() {
      const faction = factionFilter.value;
      const source = sourceFilter.value;
      const sortKey = sortFilter.value;

      return tierRows
        .filter((row) => faction === "all" || row.faction === faction)
        .filter((row) => source === "all" || row.namingSource === source)
        .sort((a, b) => b[sortKey] - a[sortKey]);
    }

    function renderEmpty() {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="10">当前筛选没有可展示条目。</td></tr>';
      cards.innerHTML = '<div class="tier-card empty-row">当前筛选没有可展示条目。</div>';
    }

    function applyFilters() {
      const rows = sortedRows();
      const sortKey = sortFilter.value;
      summary.textContent = `${rows.length} 个条目，按${sortLabels[sortKey]}降序。`;

      if (rows.length === 0) {
        renderEmpty();
        return;
      }

      tbody.innerHTML = rows.map((row, index) => `
        <tr>
          <td class="rank-cell">#${index + 1}</td>
          <td>${imageMarkup(row.imageUrl, row.imageAlt, "tier-thumb")}</td>
          <td>
            <strong>${escapeHtml(row.deckName)}</strong>
            ${deckEvidenceMarkup(row, "metric-evidence tier-evidence")}
            <span class="source-line">
              <span class="badge">${sourceLabels[row.namingSource]}</span>
              <span class="badge">${escapeHtml(row.faction)}</span>
            </span>
          </td>
          <td>${escapeHtml(row.categoryName)}<span class="row-note">${escapeHtml(row.categoryId)}</span></td>
          <td><strong>${row.rankScore}</strong></td>
          <td>${percent(row.winRate)}</td>
          <td>${percent(row.usageRate)}</td>
          <td>${row.kabukiPoints}</td>
          <td>${formatNumber(row.sampleSize)}</td>
          <td><a class="detail-link" href="#detail-placeholder" data-deck-name="${escapeHtml(row.deckName)}">占位</a></td>
        </tr>
      `).join("");

      cards.innerHTML = rows.map((row, index) => `
        <article class="tier-card">
          <div class="tier-card-head">
            ${imageMarkup(row.imageUrl, row.imageAlt, "tier-card-thumb")}
            <span class="rank">#${index + 1}</span>
            <div>
              <h3>${escapeHtml(row.deckName)}</h3>
              <span class="row-note">${escapeHtml(row.categoryName)} / ${sourceLabels[row.namingSource]} / ${escapeHtml(row.faction)}</span>
            </div>
            <span class="score">${row.rankScore}</span>
          </div>
          <div class="tier-card-metrics">
            <span class="metric-chip"><span>胜率</span><b>${percent(row.winRate)}</b></span>
            <span class="metric-chip"><span>使用率</span><b>${percent(row.usageRate)}</b></span>
            <span class="metric-chip"><span>样本数</span><b>${formatNumber(row.sampleSize)}</b></span>
          </div>
          ${deckEvidenceMarkup(row, "metric-evidence tier-evidence")}
          <a class="detail-link" href="#detail-placeholder" data-deck-name="${escapeHtml(row.deckName)}">详情占位</a>
        </article>
      `).join("");

      wireImageFallbacks(document);
    }

    [factionFilter, sourceFilter, sortFilter].forEach((control) => {
      control.addEventListener("change", applyFilters);
    });

    document.addEventListener("click", (event) => {
      const link = event.target.closest("[data-deck-name]");
      if (!link) {
        return;
      }
      detailCopy.textContent = `${link.dataset.deckName}：详情页为静态占位，当前榜单只展示指标依据。`;
    });

    applyFilters();
  }

  const page = document.body.dataset.page;
  if (page === "home") {
    renderHome();
  }
  if (page === "tier-list") {
    renderTierList();
  }
})();
