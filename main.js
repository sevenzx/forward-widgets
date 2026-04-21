import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 1. 路径准备 ---
const configFile = path.resolve(__dirname, "widgets.config.json");
const widgetsDir = path.resolve(__dirname, "widgets");
const outputFile = path.resolve(__dirname, "widgets.fwd");

if (!fs.existsSync(widgetsDir)) {
  fs.mkdirSync(widgetsDir, { recursive: true });
}

// --- 2. 读取配置 ---

// 读取外部 JSON 配置，避免主脚本里堆积 URL 和元数据配置。
const loadConfig = () => {
  const content = fs.readFileSync(configFile, "utf8");
  const config = JSON.parse(content);

  if (!Array.isArray(config.widgets)) {
    throw new Error("配置文件中的 widgets 必须是数组");
  }

  return config;
};

const CONFIG = loadConfig();
const widgetsConfig = CONFIG.widgets;

// --- 3. 工具函数 ---

// 删除临时文件，避免失败重试时残留旧的下载中间态。
const removeTempFile = (filePath) => {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

// 先下载到临时文件，只有远程内容完整拿到后才覆盖本地代码文件。
const downloadFile = (url, dest) => {
  const tempPath = `${dest}.tmp`;
  removeTempFile(tempPath);

  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            fs.writeFileSync(tempPath, Buffer.concat(chunks));
            fs.renameSync(tempPath, dest);
            resolve();
          } catch (err) {
            removeTempFile(tempPath);
            reject(err);
          }
        });
        res.on("error", (err) => {
          removeTempFile(tempPath);
          reject(err);
        });
      })
      .on("error", (err) => {
        removeTempFile(tempPath);
        reject(err);
      });
  });
};

// 解析并清洗 widget 元数据，同时把覆盖项回写到本地文件中。
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

// --- 4. 主程序 ---

// 同步远程 widgets，并在远程失效时沿用本地旧文件继续生成产物。
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
      if (!fs.existsSync(destPath)) {
        console.log(`❌ 失败: ${err.message}`);
        continue;
      }

      // 远程 URL 失效时，继续沿用本地旧文件，避免产物因为单点失败而缺项。
      const cleanData = getCleanMetadata(destPath, override);
      if (cleanData) {
        widgetList.push(cleanData);
        console.log(`⚠️ 下载失败，已沿用本地旧文件: ${err.message}`);
      } else {
        console.log(`❌ 下载失败，且本地旧文件无法解析: ${err.message}`);
      }
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
