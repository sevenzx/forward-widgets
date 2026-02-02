import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 1. 基础配置 ---
const CONFIG = {
  title: "Seven's Widgets",
  description: "Seven's personal widgets",
  icon: "https://assets.vvebo.vip/scripts/icon.png",
  baseUrl: "https://raw.githubusercontent.com/sevenzx/forward-widgets/refs/heads/master/widgets/"
};

// --- 2. 统一的对象数组配置 ---
const widgetsConfig = [
  {
    url: "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/danmu_auto.js",
    override: { title: "自动弹幕" }
  },
  {
    url: "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/danmu_api.js",
    override: { title: "弹幕API" }
  },
  {
    url: "https://raw.githubusercontent.com/MakkaPakka518/ForwardWidgets/refs/heads/main/widgets/danmuapi-Pro.js"
  },
  {
    url: "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/douban.js"
  },
  {
    url: "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/trakt.js"
  },
  {
    url: "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/live.js"
  },
  {
    url: "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/yatu.js"
  },
  {
    url: "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/zhuijurili.js"
  },
  {
    url: "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/letterboxd.js"
  },
  {
    url: "https://raw.githubusercontent.com/2kuai/ForwardWidgets/refs/heads/main/Widgets/HotPicks.js"
  },
  {
    url: "https://raw.githubusercontent.com/opix-maker/Forward/refs/heads/main/js/Bangumi_v2.0.0.js"
  }
];

// --- 3. 路径准备 ---
const widgetsDir = path.resolve(__dirname, "widgets");
const outputFile = path.resolve(__dirname, "widgets.fwd");

if (!fs.existsSync(widgetsDir)) {
  fs.mkdirSync(widgetsDir, { recursive: true });
}

// --- 4. 工具函数 ---

const downloadFile = (url, dest) => {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    }).on("error", (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
};

const getCleanMetadata = (filePath, override = {}) => {
  const code = fs.readFileSync(filePath, "utf8");
  const fileName = path.basename(filePath);

  const context = { WidgetMetadata: null };
  vm.createContext(context);

  try {
    vm.runInContext(code, context);
  } catch (e) {
    // 忽略执行环境差异导致的错误
  }

  const raw = context.WidgetMetadata;
  if (!raw) return null;

  const cleanDescription = raw.description
    ? raw.description.replace(/【.*?】/g, "").trim()
    : "";

  // 覆盖逻辑：如果 override 中有值则使用，否则使用 raw
  return {
    id: override.id || raw.id,
    title: override.title || raw.title,
    description: override.description || cleanDescription,
    requiredVersion: override.requiredVersion || raw.requiredVersion,
    version: override.version || raw.version,
    author: override.author || raw.author,
    url: `${CONFIG.baseUrl}${fileName}`
  };
};

// --- 5. 主程序 ---
async function main() {
  console.log("🚀 开始同步 Widgets (全对象配置模式)");
  const widgetList = [];

  for (const item of widgetsConfig) {
    const { url, override = {} } = item;
    const fileName = path.basename(url);
    const destPath = path.join(widgetsDir, fileName);

    try {
      process.stdout.write(`🔄 处理: ${fileName.padEnd(25)} `);

      await downloadFile(url, destPath);

      const cleanData = getCleanMetadata(destPath, override);
      if (cleanData) {
        widgetList.push(cleanData);
        console.log(`✅ ${override.title ? `[自定义标题: ${override.title}]` : ""}`);
      } else {
        console.log("⚠️ 无法解析元数据");
      }
    } catch (err) {
      console.log(`❌ 失败: ${err.message}`);
    }
  }

  const finalResult = {
    title: CONFIG.title,
    description: CONFIG.description,
    icon: CONFIG.icon,
    widgets: widgetList
  };

  fs.writeFileSync(outputFile, JSON.stringify(finalResult, null, 2), "utf8");

  console.log("\n--- 同步统计 ---");
  console.log(`✨ 成功生成: ${widgetList.length} 个项目`);
  console.log(`📝 配置文件: ${outputFile}`);
}

main();