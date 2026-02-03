WidgetMetadata = {
  id: "platform.originals.ui.fix",
  title: "播出平台",
  author: "𝙈𝙖𝙠𝙠𝙖𝙋𝙖𝙠𝙠𝙖",
  description: "发现Netflix/HBO/腾讯/B站等平台自制内容",
  version: "1.0.4",
  requiredVersion: "0.0.1",
  site: "https://www.themoviedb.org",

    globalParams: [],

    modules: [
        {
            title: "独家原创",
            functionName: "loadPlatformOriginals",
            type: "list",
            cacheDuration: 3600,
            params: [
                {
                    name: "network",
                    title: "出品平台",
                    type: "enumeration",
                    value: "213",
                    enumOptions: [
                        { title: "Netflix (网飞)", value: "213" },
                        { title: "HBO (Max)", value: "49" },
                        { title: "Apple TV+", value: "2552" },
                        { title: "Disney+", value: "2739" },
                        { title: "Amazon Prime", value: "1024" },
                        { title: "Hulu", value: "453" },
                        { title: "腾讯视频", value: "2007" },
                        { title: "爱奇艺", value: "1330" },
                        { title: "优酷", value: "1419" },
                        { title: "芒果TV", value: "1631" },
                        { title: "Bilibili", value: "1605" }
                    ]
                },
                {
                    name: "genre",
                    title: "叠加类型",
                    type: "enumeration",
                    value: "",
                    enumOptions: [
                        { title: "全部", value: "" },
                        { title: "剧情", value: "18" },
                        { title: "科幻/奇幻", value: "10765" },
                        { title: "动画", value: "16" },
                        { title: "喜剧", value: "35" },
                        { title: "动作/冒险", value: "10759" },
                        { title: "犯罪", value: "80" },
                        { title: "悬疑", value: "9648" },
                        { title: "纪录片", value: "99" }
                    ]
                },
                {
                    name: "sortBy",
                    title: "排序方式",
                    type: "enumeration",
                    value: "popularity.desc",
                    enumOptions: [
                        { title: "🔥 近期热度", value: "popularity.desc" },
                        { title: "⭐ 历史评分", value: "vote_average.desc" },
                        { title: "📅 最新首播", value: "first_air_date.desc" }
                    ]
                },
                // 必须显式声明 page 参数，Forward 才会启用分页机制
                {
                    name: "page",
                    title: "页码",
                    type: "page"
                }
            ]
        }
    ]
};

const GENRE_MAP = {
    10759: "动作冒险", 16: "动画", 35: "喜剧", 80: "犯罪", 99: "纪录片",
    18: "剧情", 10751: "家庭", 10762: "儿童", 9648: "悬疑", 10763: "新闻",
    10764: "真人秀", 10765: "科幻奇幻", 10766: "肥皂剧", 10767: "脱口秀",
    10768: "战争政治", 37: "西部"
};

async function loadPlatformOriginals(params = {}) {
    const { network = "213", genre = "", sortBy = "popularity.desc" } = params;
    // 获取分页参数，默认为 1
    const page = params.page || 1;

    const queryParams = {
        language: "zh-CN",
        include_adult: false,
        include_null_first_air_dates: false,
        page: page, // 传入动态页码
        with_networks: network,
        sort_by: sortBy
    };

    if (genre) queryParams.with_genres = genre;
    if (sortBy.includes("vote_average")) queryParams["vote_count.gte"] = 200;

    try {
        const res = await Widget.tmdb.get("/discover/tv", { params: queryParams });
        const data = res || {};

        if (!data.results || data.results.length === 0) {
            // 如果第一页就没数据，返回提示；如果是翻页到底了，返回空数组即可
            return page === 1 ? [{ id: "empty", title: "无数据", type: "text" }] : [];
        }

        return data.results.map(item => {
            const genreNames = (item.genre_ids || [])
                .map(id => GENRE_MAP[id])
                .filter(Boolean)
                .slice(0, 3)
                .join(" / ");
            
            const date = item.first_air_date || "";
            const year = date.substring(0, 4);
            const score = item.vote_average ? item.vote_average.toFixed(1) : "0.0";

            return {
                id: String(item.id),
                tmdbId: parseInt(item.id),
                type: "tmdb",
                mediaType: "tv",
                title: item.name || item.original_name,
                genreTitle: [year, genreNames].filter(Boolean).join(" • "),
                subTitle: `TMDB ${score}`,
                description: item.overview || "暂无简介",
                posterPath: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : "",
                backdropPath: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : "",
                rating: score,
                year: year
            };
        });

    } catch (e) {
        return [{ id: "err_net", title: "网络错误", description: e.message, type: "text" }];
    }
}
