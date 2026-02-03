import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 1. 基础配置 ---
const CONFIG = {
  title: "Lucky7 Widgets",
  description: "personal forward widgets",
  icon: "https://assets.vvebo.vip/scripts/icon.png",
  baseUrl:
    "https://raw.githubusercontent.com/sevenzx/forward-widgets/refs/heads/master/widgets/",
};

// --- 2. 统一的对象数组配置 ---
const widgetsConfig = [
  {
    url: "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/douban.js",
  },
  {
    url: "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/trakt.js",
  },
  {
    url: "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/live.js",
  },
  {
    url: "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/yatu.js",
  },
  {
    url: "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/zhuijurili.js",
  },
  {
    url: "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/letterboxd.js",
  },
  {
    url: "https://raw.githubusercontent.com/2kuai/ForwardWidgets/refs/heads/main/Widgets/HotPicks.js",
  },
  {
    url: "https://raw.githubusercontent.com/opix-maker/Forward/refs/heads/main/js/Bangumi_v2.0.0.js",
  },
  {
    url: "https://raw.githubusercontent.com/MakkaPakka518/ForwardWidgets/refs/heads/main/widgets/pingtaidujia.js",
    override: { title: "播出平台" },
  },
  {
    url: "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/danmu_auto.js",
    override: { title: "自动弹幕" },
  },
  {
    url: "https://raw.githubusercontent.com/huangxd-/ForwardWidgets/refs/heads/main/widgets/danmu_api.js",
    override: { title: "弹幕API" },
  },
  {
    url: "https://raw.githubusercontent.com/MakkaPakka518/ForwardWidgets/refs/heads/main/widgets/danmuapi-Pro.js",
  },
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
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
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

  const finalData = {
    id: override.id || raw.id,
    title: override.title || raw.title,
    description: override.description || cleanDescription,
    requiredVersion: override.requiredVersion || raw.requiredVersion,
    version: override.version || raw.version,
    author: override.author || raw.author,
  };

  const metadataRegex =
    /(const\s+|var\s+)?(WidgetMetadata\s*=\s*\{)([\s\S]*?)(\};)/;
  const match = code.match(metadataRegex);

  if (match) {
    let metadataContent = match[3];
    const originalMetadataContent = metadataContent;

    const complexContents = [];
    const complexFieldNames = ["modules", "globalParams", "params"];
    let tempMetadataContent = metadataContent;

    for (const fieldName of complexFieldNames) {
      const fieldRegex = new RegExp(`(\\b${fieldName}\\b\\s*:\\s*\\[)`);
      const fieldMatch = tempMetadataContent.match(fieldRegex);
      if (!fieldMatch) continue;

      const startIndex = fieldMatch.index;
      // Start searching for the closing bracket after the opening one.
      const contentStartIndex = fieldMatch.index + fieldMatch[0].length;

      let balance = 1;
      let endIndex = -1;
      for (let i = contentStartIndex; i < tempMetadataContent.length; i++) {
        if (tempMetadataContent[i] === "[") balance++;
        else if (tempMetadataContent[i] === "]") balance--;
        if (balance === 0) {
          endIndex = i;
          break;
        }
      }

      if (endIndex !== -1) {
        // The block includes the key, like `modules: [...]`
        const block = tempMetadataContent.substring(startIndex, endIndex + 1);
        const placeholder = `__PLACEHOLDER_${complexContents.length}__`;
        complexContents.push(block);
        tempMetadataContent = tempMetadataContent.replace(block, placeholder);
      }
    }

    let processedContent = tempMetadataContent;
    for (const [key, value] of Object.entries(finalData)) {
      if (value === undefined || value === null) continue;
      const fieldRegex = new RegExp(`(${key}\\s*:\\s*)(['"])(.*?)(['"])(,?)`);
      const fieldMatch = processedContent.match(fieldRegex);

      if (fieldMatch) {
        const existingValue = fieldMatch[3];
        if (existingValue !== value) {
          const quote = fieldMatch[2];
          const escapedValue = value
            .replace(/\\/g, "\\\\")
            .replace(/\n/g, "\\n")
            .replace(new RegExp(quote, "g"), `\\${quote}`);
          processedContent = processedContent.replace(
            fieldRegex,
            `$1$2${escapedValue}$4$5`,
          );
        }
      }
    }

    complexContents.forEach((block, index) => {
      processedContent = processedContent.replace(
        `__PLACEHOLDER_${index}__`,
        block,
      );
    });

    metadataContent = processedContent;

    if (originalMetadataContent !== metadataContent) {
      const constOrVarPart = match[1] || "";
      const newMetadataBlock = `${constOrVarPart}${match[2]}${metadataContent}${match[4]}`;
      const updatedCode = code.replace(match[0], newMetadataBlock);
      fs.writeFileSync(filePath, updatedCode, "utf8");
    }
  }

  // 覆盖逻辑：如果 override 中有值则使用，否则使用 raw
  return {
    ...finalData,
    url: `${CONFIG.baseUrl}${fileName}`,
  };
};

// --- 5. 主程序 ---
async function main() {
  console.log("🚀 开始同步 Widgets");
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
        console.log(
          `✅ ${override.title ? `[自定义标题: ${override.title}]` : ""}`,
        );
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
    widgets: widgetList,
  };

  fs.writeFileSync(outputFile, JSON.stringify(finalResult, null, 2), "utf8");

  console.log("\n--- 同步统计 ---");
  console.log(`✨ 成功生成: ${widgetList.length} 个项目`);
  console.log(`📝 配置文件: ${outputFile}`);
}

main();
