const express = require("express");
const app = express();
const port = process.env.PORT || 3000;
// 修改以下参数，以使用哪吒面板。格式为：服务器地址 端口 密钥
const nezha = ""
var exec = require("child_process").exec;
const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
// 启动 web.js 前生成运行时配置：若环境变量 WARP_PRIVATE_KEY 存在，
// 用它覆盖 config.json 里 WARP 出站的 secretKey（仓库里的 config.json 只留占位值）。
function prepareConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync("./config.json", "utf8"));
    const wg = (cfg.outbounds || []).find((o) => o.protocol === "wireguard");
    if (wg && wg.settings) {
      const cur = (wg.settings.secretKey || "").trim();
      if (cur.startsWith("ENC:")) {
        const pass = (process.env.WARP_DECRYPT_KEY || "").trim();
        if (!pass) {
          console.log("运行时配置:config 里是加密密钥,但未设置 WARP_DECRYPT_KEY 环境变量,WARP 将无法连接");
        } else {
          try {
            wg.settings.secretKey = decryptEnc(cur, pass);
            console.log("运行时配置:已用 WARP_DECRYPT_KEY 解密并注入 WARP 密钥");
          } catch (e) {
            console.log("运行时配置:WARP 密钥解密失败(口令不对或密文损坏),WARP 将无法连接");
          }
        }
      } else {
        const key = (process.env.WARP_PRIVATE_KEY || "").trim();
        if (key) {
          wg.settings.secretKey = key;
          console.log("运行时配置:已从环境变量注入 WARP 密钥");
        } else if (cur === "FILL_IN_YOUR_PRIVATE_KEY") {
          console.log("运行时配置:WARP 密钥仍为占位值,将无法连接");
        }
      }
    }
    fs.writeFileSync("./config.runtime.json", JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.log("运行时配置:生成失败,回退使用 config.json:" + e);
    return "./config.json";
  }
  return "./config.runtime.json";
}
// [decryptEnc begin]
// 解密 ENC:v1: 密文（口令经 scrypt 派生密钥，ChaCha20-Poly1305 解密）。
// 与加密小工具 encrypt_warp_key.py 的格式严格对应。
function decryptEnc(encText, passphrase) {
  const raw = Buffer.from(encText.slice("ENC:v1:".length), "base64");
  const salt = raw.subarray(0, 16);
  const nonce = raw.subarray(16, 28);
  const tag = raw.subarray(raw.length - 16);
  const ct = raw.subarray(28, raw.length - 16);
  const key = crypto.scryptSync(passphrase, salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const decipher = crypto.createDecipheriv("chacha20-poly1305", key, nonce, {
    authTagLength: 16,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
// [decryptEnc end]
const { createProxyMiddleware } = require("http-proxy-middleware");
var request = require("request");
//const fetch = require("node-fetch");
const render_app_url = "https://" + process.env.RENDER_EXTERNAL_HOSTNAME;

app.get("/", (req, res) => {
  res.send("hello world");
});

app.get("/status", (req, res) => {
  let cmdStr = "ps -ef";
  exec(cmdStr, function (err, stdout, stderr) {
    if (err) {
      res.type("html").send("<pre>命令行执行出错：\n" + err + "</pre>");
    } else {
      res.type("html").send("<pre>命令行执行结果：\n" + stdout + "</pre>");
    }
  });
});

app.get("/start", (req, res) => {
  let cfgPath = prepareConfig();
  let cmdStr = "./web.js -c " + cfgPath + " >/dev/null 2>&1 &";
  exec(cmdStr, function (err, stdout, stderr) {
    if (err) {
      res.send("命令行执行错误：" + err);
    } else {
      res.send("命令行执行结果:web.js启动成功!");
    }
  });
});

app.get("/nezha", (req, res) => {
  let cmdStr = "/bin/bash nezha.sh " + nezha + " >/dev/null 2>&1 &";
  exec(cmdStr, function (err, stdout, stderr) {
    if (err) {
      res.send("哪吒客户端部署错误：" + err);
    } else {
      res.send("哪吒客户端执行结果：" + "启动成功!");
    }
  });
});

app.get("/info", (req, res) => {
  let cmdStr = "cat /etc/*release | grep -E ^NAME";
  exec(cmdStr, function (err, stdout, stderr) {
    if (err) {
      res.send("命令行执行错误：" + err);
    } else {
      res.send(
        "命令行执行结果：\n" +
          "Linux System:" +
          stdout +
          "\nRAM:" +
          os.totalmem() / 1000 / 1000 +
          "MB"
      );
    }
  });
});

app.use(
  "/",
  createProxyMiddleware({
    target: "http://127.0.0.1:8080/", // 需要跨域处理的请求地址
    changeOrigin: true, // 默认false，是否需要改变原始主机头为目标URL
    ws: true, // 是否代理websockets
    pathRewrite: {
      "^/": "/",
    },
    onProxyReq: function onProxyReq(proxyReq, req, res) {
      //console.log("-->  ",req.method,req.baseUrl,"->",proxyReq.host + proxyReq.path);
    },
  })
);

/* keepalive  begin */
function keepalive() {
  // 1.请求主页，保持唤醒
  request(render_app_url, function (error, response, body) {
    if (!error) {
      console.log("主页发包成功！");
      console.log("响应报文:", body);
    } else console.log("请求错误: " + error);
  });

  //2. 本地进程检测,保活web.js
  exec("ps -ef", function (err, stdout, stderr) {
    if (err) {
      console.log("保活web.js-本地进程检测-命令行执行失败:" + err);
    } else {
      if (stdout.includes("./web.js -c"))
        console.log("保活web.js-本地进程检测-web.js正在运行");
      //命令调起web.js
      else startWeb();
      if (stdout.includes("/bin/bash nezha.sh"))
        console.log("保活哪吒-本地进程检测-哪吒正在运行")
      else startNezha();
    }
  });
}
//保活频率设置为30秒
setInterval(keepalive, 30 * 1000);
/* keepalive  end */

function startWeb() {
  let cfgPath = prepareConfig();
  let startWebCMD = "chmod +x ./web.js && ./web.js -c " + cfgPath + " >/dev/null 2>&1 &";
  exec(startWebCMD, function (err, stdout, stderr) {
    if (err) {
      console.log("启动web.js-失败:" + err);
    } else {
      console.log("启动web.js-成功!");
    }
  });
}

function startNezha() {
  let startNezhaCMD = "/bin/bash nezha.sh " + nezha + " >/dev/null 2>&1 &";
  exec(startNezhaCMD, function (err, stdout, stderr) {
    if (err) {
      console.log("启动哪吒-失败:" + err);
    } else {
      console.log("启动哪吒-成功!");
    }
  });
}

/* init  begin */
exec("tar -zxvf src.tar.gz", function (err, stdout, stderr) {
  if (err) {
    console.log("初始化-解压资源文件src.tar.gz-失败:" + err);
  } else {
    console.log("初始化-解压资源文件src.tar.gz-成功!");
    startWeb();
    startNezha();
  }
});
/* init  end */

app.listen(port, () => console.log(`App is listening on port ${port}!`));