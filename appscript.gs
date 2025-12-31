
const SPREADSHEET_ID = "1RYSK9mn2ByZAWnNMV3_riMYGBK8dW_J3jVi0XRivBPw"; 
const SHEET_NAME = "Items";
const USERS_SHEET_NAME = "Users";


const ADMIN_EMAILS = [
  "malikritesh316@gmail.com",
  "riteshmalik21092005@gmail.com", 
  "25ucc171@lnmiit.ac.in", 
  "25ucs138@lnmiit.ac.in",
  "25ucc121@lnmiit.ac.in"
];


const DISCORD_WEBHOOK_URL = ""; 


function doGet(e) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_NAME);
    
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(["ID", "Type", "Item", "Desc", "Status", "Reporter", "Email", "Date", "Image", "Lat", "Lng"]);
      return response({ status: "success", data: [] });
    }

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return response({ status: "success", data: [] });
    
    const headers = data.shift(); 
    const json = data.map((row, index) => ({
      rowIndex: index + 2,
      id: row[0],
      type: row[1],
      item: row[2],
      desc: row[3],
      status: row[4],
      reporter: row[5],
      email: row[6],
      date: row[7],
      image: row[8],
      lat: row[9],
      lng: row[10]
    })).reverse(); 

    return response({ status: "success", data: json });
  } catch (error) {
    return response({ status: "error", message: error.toString() });
  }
}


function doPost(e) {
  const lock = LockService.getScriptLock();
  
  try {
    lock.waitLock(10000); 
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const params = JSON.parse(e.postData.contents);
    const action = params.action;

   
    if (action === "REPORT") {
      let sheet = ss.getSheetByName(SHEET_NAME);
      if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
      
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        const lastData = sheet.getRange(lastRow, 7, 1, 2).getValues()[0];
        const lastEmail = lastData[0];
        const lastTime = new Date(lastData[1]).getTime();
        const currentTime = new Date().getTime();
        
        if (lastEmail === params.email && (currentTime - lastTime) < 30000) {
          return response({ result: "error", message: "⏳ Slow down! Please wait 30s." });
        }
      }

      
      const id = Utilities.getUuid(); 
      sheet.appendRow([
        id, params.type, params.item, params.desc, "Open", 
        params.reporter, params.email, new Date(), 
        params.image || "", params.lat || "", params.lng || ""
      ]);

      
      runSentinelCheck(ss, params);

     
      if (DISCORD_WEBHOOK_URL) sendToDiscord(params);

     
      if (ADMIN_EMAILS.includes(params.email)) {
         broadcastNewReportToAll(ss, params); 
      }

      return response({ result: "success", message: "Report Submitted" });
    }

  
    else if (action === "REGISTER_USER") {
      let uSheet = ss.getSheetByName(USERS_SHEET_NAME);
      if (!uSheet) { uSheet = ss.insertSheet(USERS_SHEET_NAME); uSheet.appendRow(["Email", "Joined Date"]); }
      
      const data = uSheet.getDataRange().getValues();
      if (!data.some(r => r[0] === params.email)) {
        uSheet.appendRow([params.email, new Date()]);
      }
      return response({ result: "success" });
    }

    
    else if (action === "RESOLVE") {
      if (!ADMIN_EMAILS.includes(params.adminEmail)) return response({ result: "error", message: "Unauthorized" });
      const sheet = ss.getSheetByName(SHEET_NAME);
      sheet.getRange(params.rowIndex, 5).setValue("Resolved");
      return response({ result: "success" });
    }


    else if (action === "BROADCAST") {
      if (!ADMIN_EMAILS.includes(params.adminEmail)) return response({ result: "error", message: "Unauthorized" });

      const userSheet = ss.getSheetByName(USERS_SHEET_NAME);
      if (!userSheet) return response({ result: "error", message: "No users." });

      const rawData = userSheet.getDataRange().getValues();
      let emails = rawData.slice(1).map(r => r[0]).filter(e => e && e.toString().includes("@"));
      emails = [...new Set(emails)]; 

      if (emails.length === 0) return response({ result: "error", message: "No users." });

      const htmlBody = `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4f46e5; text-align: center;">📢 Campus Announcement</h2>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 16px; line-height: 1.5; color: #333;">${params.message}</p>
        </div>
      `;

      const count = sendEmailInBatches(emails, "📢 LNMIIT Portal: " + params.subject, htmlBody);
      return response({ result: "success", message: `Sent to ${count} users.` });
    }

  } catch (e) {
    Logger.log("FATAL ERROR: " + e.toString());
    return response({ result: "error", message: e.toString() });
  } finally {
    lock.releaseLock();
  }
}



function runSentinelCheck(ss, newParams) {
  try {
    const sheet = ss.getSheetByName(SHEET_NAME);
    const rows = sheet.getDataRange().getValues();
    const targetType = (newParams.type === "Lost") ? "Found" : "Lost";
    const newItemName = newParams.item.toLowerCase();

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[1] === targetType && row[4] === "Open" && 
         (row[2].toLowerCase().includes(newItemName) || newItemName.includes(row[2].toLowerCase()))) {
        sendMatchEmail(row[6], newParams, row);
      }
    }
  } catch(e) { Logger.log("Sentinel Error: " + e); }
}

function sendMatchEmail(recipientEmail, newReport, matchedDbRow) {
  const isGoodNews = newReport.type === "Found";
  const subject = isGoodNews ? `⚡ GOOD NEWS: Match Found for "${newReport.item}"` : `👀 UPDATE: Potential match for "${newReport.item}"`;
  
  const htmlBody = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden;">
      <div style="background-color: ${isGoodNews ? '#22c55e' : '#f59e0b'}; padding: 20px; text-align: center;">
        <h2 style="color: white; margin: 0;">${isGoodNews ? 'MATCH FOUND!' : 'POTENTIAL MATCH'}</h2>
      </div>
      <div style="padding: 30px; background-color: #fff;">
        <p style="font-size: 16px; color: #333;">We found a potential match for your item!</p>
        <div style="background-color: #f8fafc; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0;">
          <p><b>Item:</b> ${newReport.item}</p>
          <p><b>Description:</b> ${newReport.desc.replace(/\|\|.*$/, "")}</p>
          ${newReport.image ? `<img src="${newReport.image}" style="max-width:100%; height:auto; border-radius:8px; margin-top:10px;">` : ''}
        </div>
        <div style="text-align: center;">
          <a href="mailto:${newReport.email}" style="background-color: #0f172a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Contact Finder</a>
        </div>
      </div>
    </div>
  `;
  MailApp.sendEmail({ to: recipientEmail, subject: subject, htmlBody: htmlBody });
}

function broadcastNewReportToAll(ss, params) {
  try {
    const userSheet = ss.getSheetByName(USERS_SHEET_NAME);
    if (!userSheet) return;
    const emails = userSheet.getDataRange().getValues().slice(1).map(r => r[0]).filter(e => e && e.toString().includes("@"));
    const uniqueEmails = [...new Set(emails)];
    if (uniqueEmails.length === 0) return;

    const isLost = params.type === 'Lost';
    const headerColor = isLost ? '#ef4444' : '#22c55e';
    const badgeText = isLost ? '🔴 LOST ITEM REPORTED' : '🟢 ITEM FOUND';
    const imageHtml = params.image ? `<div style="text-align: center; margin: 20px 0;"><img src="${params.image}" style="max-width: 100%; max-height: 300px; border-radius: 8px; object-fit: cover;"></div>` : '';

    const htmlBody = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden;">
         <div style="background-color: ${headerColor}; padding: 20px; text-align: center;">
             <h2 style="color: white; margin: 0;">${badgeText}</h2>
         </div>
         <div style="padding: 30px;">
             <h1 style="text-align: center;">${params.item}</h1>
             ${imageHtml}
             <p><b>Description:</b> ${params.desc.replace(/\|\|.*$/, "")}</p>
             <div style="text-align: center; margin-top: 30px;">
                <a href="mailto:${params.email}" style="background-color: #0f172a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Contact Reporter</a>
             </div>
         </div>
      </div>
    `;
    sendEmailInBatches(uniqueEmails, `${isLost ? '🔴' : '🟢'} New Report: ${params.item}`, htmlBody);
  } catch (e) { Logger.log("Broadcast Error: " + e); }
}

function sendEmailInBatches(recipientList, subject, htmlBody) {
  const CHUNK_SIZE = 40; 
  let sentCount = 0;
  for (let i = 0; i < recipientList.length; i += CHUNK_SIZE) {
    const chunk = recipientList.slice(i, i + CHUNK_SIZE);
    if (chunk.length > 0) {
      try {
        MailApp.sendEmail({ to: ADMIN_EMAILS[0], bcc: chunk.join(","), subject: subject, htmlBody: htmlBody });
        sentCount += chunk.length;
        Utilities.sleep(1000); 
      } catch (err) { Logger.log("Batch Error: " + err); }
    }
  }
  return sentCount;
}

function sendToDiscord(p) {
  try {
    const isLost = p.type === 'Lost';
    const color = isLost ? 15548997 : 5763719;
    const payload = {
      "username": "Lost & Found Bot",
      "avatar_url": "https://cdn-icons-png.flaticon.com/512/4686/4686036.png",
      "embeds": [{
        "title": `${isLost ? "🔴 LOST" : "🟢 FOUND"}: ${p.item}`,
        "description": p.desc.replace(/\|\|.*$/, ""),
        "color": color,
        "fields": [{ "name": "Contact", "value": p.email, "inline": true }],
        "thumbnail": { "url": p.image || "" }
      }]
    };
    UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, { method: "post", contentType: "application/json", payload: JSON.stringify(payload) });
  } catch(e) { Logger.log("Discord Error: " + e); }
}

function response(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function checkMyQuota() {
  var remaining = MailApp.getRemainingDailyQuota();
  Logger.log("🚨 EMAILS LEFT FOR TODAY: " + remaining);
}
