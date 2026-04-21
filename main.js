import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliArgs = new Set(process.argv.slice(2));

// --- 1. 路径准备 ---
const configFile = path.resolve(__dirname, "widgets.config.yaml");
const widgetsDir = path.resolve(__dirname, "widgets");
const outputFile = path.resolve(__dirname, "widgets.fwd");

if (!fs.existsSync(widgetsDir)) {
  fs.mkdirSync(widgetsDir, { recursive: true });
}

// --- 2. 读取配置 ---

// 解析命令行参数，区分普通同步、检查更新和升级版本三种模式。
const parseCliOptions = () => {
  const options = {
    checkUpdates: cliArgs.has("--check-updates"),
    bump: cliArgs.has("--bump"),
  };

  if (options.checkUpdates && options.bump) {
    throw new Error("--check-updates 与 --bump 不能同时使用");
  }

  return options;
};

// 读取外部 YAML 配置，避免主脚本里堆积 URL 和元数据配置。
const loadConfig = () => {
  const content = fs.readFileSync(configFile, "utf8");
  const config = YAML.parse(content);

  if (!Array.isArray(config.widgets)) {
    throw new Error("配置文件中的 widgets 必须是数组");
  }

  return config;
};

// 将更新后的配置写回 YAML，持久化锁定版本等状态。
const saveConfig = (config) => {
  fs.writeFileSync(configFile, YAML.stringify(config), "utf8");
};

const CLI_OPTIONS = parseCliOptions();
const CONFIG = loadConfig();
const widgetsConfig = CONFIG.widgets;

// --- 3. 工具函数 ---

// 删除临时文件，避免失败重试时残留旧的下载中间态。
const removeTempFile = (filePath) => {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

// 获取远程内容，统一处理 HTTP 状态码和网络异常。
const fetchBuffer = (url) => {
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
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
};

// 获取远程 JSON，用于检查 npm 包的最新版本。
const fetchJson = async (url) => {
  const content = await fetchBuffer(url);
  return JSON.parse(content.toString("utf8"));
};

// 先下载到临时文件，只有远程内容完整拿到后才覆盖本地代码文件。
const downloadFile = async (url, dest) => {
  const tempPath = `${dest}.${process.pid}.tmp`;
  removeTempFile(tempPath);

  try {
    const content = await fetchBuffer(url);
    fs.writeFileSync(tempPath, content);
    fs.renameSync(tempPath, dest);
  } catch (err) {
    removeTempFile(tempPath);
    throw err;
  }
};

// 获取 npm 包最新版本，用于检查更新或执行主动升级。
const getLatestPackageVersion = async (packageName) => {
  const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;
  const pkgInfo = await fetchJson(registryUrl);
  return pkgInfo.version;
};

// 根据 npm 包名、锁定版本和入口文件拼出稳定的 unpkg 下载地址。
const buildUnpkgUrl = (packageName, packageVersion, entry) => {
  const normalizedEntry = entry.replace(/^\/+/, "");
  return `https://unpkg.com/${packageName}@${packageVersion}/${normalizedEntry}`;
};

// 将不同来源的配置项解析成统一的下载描述。
const resolveWidgetItem = async (item, cliOptions) => {
  if (item.source === "npm") {
    if (!item.package || !item.entry || !item.packageVersion) {
      throw new Error("npm 源必须包含 package、entry 和 packageVersion");
    }

    let targetVersion = item.packageVersion;
    let latestVersion = null;

    if (cliOptions.checkUpdates || cliOptions.bump) {
      latestVersion = await getLatestPackageVersion(item.package);
    }

    if (cliOptions.bump && latestVersion && latestVersion !== item.packageVersion) {
      targetVersion = latestVersion;
    }

    return {
      item,
      override: item.override || {},
      url: buildUnpkgUrl(item.package, targetVersion, item.entry),
      fileName: path.basename(item.entry),
      packageName: item.package,
      packageVersion: item.packageVersion,
      targetPackageVersion: targetVersion,
      latestPackageVersion: latestVersion,
    };
  }

  if (!item.url) {
    throw new Error("普通源必须包含 url");
  }

  return {
    item,
    override: item.override || {},
    url: item.url,
    fileName: path.basename(item.url),
    packageName: null,
    packageVersion: null,
    targetPackageVersion: null,
    latestPackageVersion: null,
  };
};

// 检查所有 npm 源条目的上游版本，并输出是否有新版本可升级。
const checkWidgetUpdates = async (items) => {
  console.log("🔍 开始检查 npm 包更新");

  const npmItems = items.filter((item) => item.packageName);
  if (npmItems.length === 0) {
    console.log("ℹ️ 当前没有 npm 源条目");
    return;
  }

  let updateCount = 0;
  for (const item of npmItems) {
    if (!item.latestPackageVersion || item.latestPackageVersion === item.packageVersion) {
      console.log(`✅ ${item.packageName} 当前已是最新版本 ${item.packageVersion}`);
      continue;
    }

    updateCount += 1;
    console.log(
      `🆕 ${item.packageName} 可从 ${item.packageVersion} 升级到 ${item.latestPackageVersion}`,
    );
  }

  console.log("\n--- 检查统计 ---");
  console.log(`📦 检查条目: ${npmItems.length} 个`);
  console.log(`✨ 可升级项: ${updateCount} 个`);
};

// 预处理配置项，统一生成后续同步所需的下载信息。
const prepareWidgetItems = async (items, cliOptions) => {
  const preparedItems = [];

  for (const item of items) {
    preparedItems.push(await resolveWidgetItem(item, cliOptions));
  }

  return preparedItems;
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
const syncWidgets = async (items, cliOptions) => {
  console.log("🚀 开始同步 Widgets");
  const widgetList = [];
  let hasConfigUpdate = false;

  for (const item of items) {
    const { url, override, fileName, targetPackageVersion, packageVersion } = item;
    const destPath = path.join(widgetsDir, fileName);

    try {
      process.stdout.write(`🔄 处理: ${fileName.padEnd(25)} `);

      await downloadFile(url, destPath);

      const cleanData = getCleanMetadata(destPath, override);
      if (cleanData) {
        widgetList.push(cleanData);

        // 只有在新版本下载并解析成功后，才把锁定版本反写回配置文件。
        if (
          cliOptions.bump &&
          item.packageName &&
          targetPackageVersion &&
          targetPackageVersion !== packageVersion
        ) {
          item.item.packageVersion = targetPackageVersion;
          hasConfigUpdate = true;
        }

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

  if (hasConfigUpdate) {
    saveConfig(CONFIG);
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
  if (hasConfigUpdate) {
    console.log(`🔒 已回写锁定版本: ${configFile}`);
  }
};

// 作为脚本入口，按命令行模式选择检查更新或执行同步。
async function main() {
  const preparedItems = await prepareWidgetItems(widgetsConfig, CLI_OPTIONS);

  if (CLI_OPTIONS.checkUpdates) {
    await checkWidgetUpdates(preparedItems);
    return;
  }

  await syncWidgets(preparedItems, CLI_OPTIONS);
}

main();
