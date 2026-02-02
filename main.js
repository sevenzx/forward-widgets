import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. 基础配置
const CONFIG = {
    title: "Seven's Widgets",
    description: "Seven's personal widgets",
    icon: "https://assets.vvebo.vip/scripts/icon.png",
    // 替换为你自己的仓库路径
    baseUrl:
        "https://raw.githubusercontent.com/sevenzx/forward-widgets/refs/heads/master/widgets/",
};

// 2. 更新后的 URL 列表
const urls = [
    "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/danmu_auto.js",
    "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/danmu_api.js",
    "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/douban.js",
    "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/trakt.js",
    "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/live.js",
    "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/yatu.js",
    "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/zhuijurili.js",
    "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/letterboxd.js",
    "https://raw.githubusercontent.com/2kuai/ForwardWidgets/refs/heads/main/Widgets/HotPicks.js",
    "https://raw.githubusercontent.com/opix-maker/Forward/refs/heads/main/js/Bangumi_v2.0.0.js",
];

const widgetsDir = path.resolve(__dirname, "widgets");
const outputFile = path.resolve(__dirname, "widgets.fwd");

if (!fs.existsSync(widgetsDir)) {
    fs.mkdirSync(widgetsDir, { recursive: true });
}

const downloadFile = (url, dest) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https
            .get(url, (res) => {
                if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}`));
                res.pipe(file);
                file.on("finish", () => {
                    file.close();
                    resolve();
                });
            })
            .on("error", (err) => {
                fs.unlink(dest, () => reject(err));
            });
    });
};

/**
 * 解析 WidgetMetadata 并清理描述信息
 */
const getCleanMetadata = (filePath) => {
    const code = fs.readFileSync(filePath, "utf8");
    const fileName = path.basename(filePath);

    const context = { WidgetMetadata: null };
    vm.createContext(context);

    try {
        vm.runInContext(code, context);
    } catch (e) {
        // 忽略运行时环境相关的错误
    }

    const raw = context.WidgetMetadata;
    if (!raw) return null;

    // 正则：删除 【...】 包含的内容并去除首尾空格
    const cleanDescription = raw.description
        ? raw.description.replace(/【.*?】/g, "").trim()
        : "";

    // 严格返回你需要的 6 个核心字段 + 拼接后的 url
    return {
        id: raw.id,
        title: raw.title,
        description: cleanDescription,
        requiredVersion: raw.requiredVersion,
        version: raw.version,
        author: raw.author,
        url: `${CONFIG.baseUrl}${fileName}`,
    };
};

async function main() {
    console.log("🚀 开始更新 Widgets");
    const widgetList = [];

    for (const url of urls) {
        const fileName = path.basename(url);
        const destPath = path.join(widgetsDir, fileName);

        try {
            process.stdout.write(`🔄 处理: ${fileName} ... `);
            await downloadFile(url, destPath);

            const cleanData = getCleanMetadata(destPath);
            if (cleanData) {
                widgetList.push(cleanData);
                console.log("✅");
            } else {
                console.log("⚠️ 未找到 WidgetMetadata 变量");
            }
        } catch (err) {
            console.log(`❌ 失败: ${err.message}`);
        }
    }

    const finalResult = {
        title: CONFIG.title,
        description: CONFIG.description,
        icon: CONFIG.icon,
        widgets: widgetList,
    };

    fs.writeFileSync(outputFile, JSON.stringify(finalResult, null, 2), "utf8");
    console.log(`\n✨ 同步成功！`);
    console.log(`📂 文件已下载至: ${widgetsDir}`);
    console.log(`📝 配置文件已生成: ${outputFile}`);
}

main();
