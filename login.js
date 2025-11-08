// --- START OF FILE login.js  ---

const axios = require('axios');
const { chromium } = require('playwright');
const fs = require('fs');

const token = process.env.BOT_TOKEN;
const chatId = process.env.CHAT_ID;
const accounts = process.env.ACCOUNTS;
const LOG_FILE = 'login_history.log';
const LOG_RETENTION_DAYS = 90; 

if (!accounts) {
  console.log('❌ 未配置账号');
  process.exit(1);
}

const accountList = accounts.split(/[,;]/).map(account => {
  const [user, pass] = account.split(":").map(s => s.trim());
  return { user, pass };
}).filter(acc => acc.user && acc.pass);

if (accountList.length === 0) {
  console.log('❌ 账号格式错误，应为 username1:password1,username2:password2');
  process.exit(1);
}

function rotateLog() {
  if (!fs.existsSync(LOG_FILE)) {
    return;
  }
  try {
    console.log(`🧹 正在检查并清理 ${LOG_RETENTION_DAYS} 天前的旧日志...`);
    const retentionDate = new Date();
    retentionDate.setDate(retentionDate.getDate() - LOG_RETENTION_DAYS);

    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
    const recentLines = lines.filter(line => {
      if (!line.trim()) return false;
      const dateStr = line.split(':')[0];
      const logDate = new Date(dateStr);
      return logDate >= retentionDate;
    });

    fs.writeFileSync(LOG_FILE, recentLines.join('\n') + (recentLines.length > 0 ? '\n' : ''), 'utf8');
    console.log('✅ 旧日志清理完成。');
  } catch (e) {
    console.error(`❌ 清理日志失败: ${e.message}`);
  }
}


function writeLog(message) {
  try {
    const now = new Date();
    const hkTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const dateStr = hkTime.toISOString().split('T')[0];
    const logMessage = `${dateStr}: ${message}\n`;

    fs.appendFileSync(LOG_FILE, logMessage, 'utf8');
    console.log(`📝 日志已写入: ${message}`);
  } catch (e) {
    console.error(`❌ 写入日志失败: ${e.message}`);
  }
}

async function sendTelegram(message) {
  if (!token || !chatId) return;
  const now = new Date();
  const hkTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const timeStr = hkTime.toISOString().replace('T', ' ').substr(0, 19) + " HKT";
  const fullMessage = `🎉 Netlib 登录通知\n\n登录时间：${timeStr}\n\n${message}`;
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: fullMessage
    }, { timeout: 10000 });
    console.log('✅ Telegram 通知发送成功');
  } catch (e) {
    console.log('⚠️ Telegram 发送失败');
  }
}

async function loginWithAccount(user, pass, index) {
  const accountId = `user${index + 1}`;
  console.log(`\n🚀 开始登录: ${accountId}`);
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  let page;
  let result = { user: accountId, success: false, message: '' };
  
  try {
    page = await browser.newPage();
    page.setDefaultTimeout(30000);
    console.log(`📱 ${accountId} - 正在访问网站...`);
    await page.goto('https://www.netlib.re/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    console.log(`🔑 ${accountId} - 点击登录按钮...`);
    await page.click('text=Login', { timeout: 5000 });
    await page.waitForTimeout(2000);
    console.log(`📝 ${accountId} - 填写用户名...`);
    await page.fill('input[name="username"], input[type="text"]', user);
    await page.waitForTimeout(1000);
    console.log(`🔒 ${accountId} - 填写密码...`);
    await page.fill('input[name="password"], input[type="password"]', pass);
    await page.waitForTimeout(1000);
    console.log(`📤 ${accountId} - 提交登录...`);
    await page.click('button:has-text("Validate"), input[type="submit"]');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);
    
    const pageContent = await page.content();
    if (pageContent.includes('exclusive owner') || pageContent.includes(user)) {
      console.log(`✅ ${accountId} - 登录成功`);
      result.success = true;
      result.message = `✅ ${accountId} 登录成功`;
      writeLog(`${accountId} 登录成功`);
    } else {
      console.log(`❌ ${accountId} - 登录失败`);
      result.message = `❌ ${accountId} 登录失败`;
      writeLog(`${accountId} 登录失败`);
    }
  } catch (e) {
    console.log(`❌ ${accountId} - 登录异常: ${e.message}`);
    result.message = `❌ ${accountId} 登录异常: ${e.message}`;
    writeLog(`${accountId} 登录异常: ${e.message.split('\n')[0]}`);
  } finally {
    if (page) await page.close();
    await browser.close();
  }
  return result;
}

async function main() {
  rotateLog(); 

  console.log(`🔍 发现 ${accountList.length} 个账号需要登录`);
  const results = [];
  for (let i = 0; i < accountList.length; i++) {
    const { user, pass } = accountList[i];
    console.log(`\n📋 处理第 ${i + 1}/${accountList.length} 个账号`);
    
    const result = await loginWithAccount(user, pass, i);
    results.push(result);
    
    if (i < accountList.length - 1) {
      console.log('⏳ 等待3秒后处理下一个账号...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  const successCount = results.filter(r => r.success).length;
  const totalCount = results.length;
  let summaryMessage = `📊 登录汇总: ${successCount}/${totalCount} 个账号成功\n\n`;
  results.forEach(result => {
    summaryMessage += `${result.message}\n`;
  });
  
  await sendTelegram(summaryMessage);
  writeLog(`汇总: ${successCount}/${totalCount} 成功`);
  console.log('\n✅ 所有账号处理完成！');
}

main().catch(console.error);
