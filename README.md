# Panther Kiosk: Team 2064 Attendance System

The Panther Kiosk is a real-time, automated attendance tracking hub designed for robotics teams. It integrates Google Sheets for logging, Firebase for real-time state synchronization, and Google Calendar for automated meeting lifecycle management.

---

## 1. Google Sheets & Apps Script Setup
The kiosk uses Google Sheets as the ultimate database for attendance logs, making it easy to export, grade, or audit hours.

1. Create a new Google Sheet.
2. In the menu, click **Extensions > Apps Script**.
3. Delete any existing code and paste the `doPost` and `doGet` integration script.

```bash
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    // Helper to turn raw ISO strings into clean readable times (e.g., "May 20, 1:44 PM")
    function formatTime(isoString) {
      if (!isoString) return "";
      const dateObj = new Date(isoString);
      return dateObj.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    }
    
    const timestamp = new Date();
    const name = data.memberName || "No Name Provided";
    const role = data.role || "student";
    
    // Apply the clean formatting here
    const checkIn = formatTime(data.checkIn);
    const checkOut = formatTime(data.checkOut);
    
    const duration = data.duration || "";
    const type = data.type || "General";
    const sessionId = data.id || "No ID";
    
    // Automatically route to the correct Tab/Sheet
    const dateStr = timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const sheetName = `${dateStr} - ${type}`;
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(sheetName);
    
    // Create tab if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      const headers = ["Timestamp", "Name", "Role", "Check In", "Check Out", "Duration (Hrs)", "Type", "Session ID"];
      sheet.appendRow(headers);
      sheet.getRange("A1:H1").setFontWeight("bold").setBackground("#f3f3f3");
      sheet.setFrozenRows(1);
    }
    
    // Append the row safely
    sheet.appendRow([timestamp, name, role, checkIn, checkOut, duration, type, sessionId]);
    
    return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  if (e.parameter.action === 'checkCalendar') {
    const now = new Date();
    
    const calId = 'c_a246400a88a21fe4e3b65cc96f43ae4020788d8410fe2a1c572ab632d872a20a@group.calendar.google.com';
    let cal = CalendarApp.getCalendarById(calId);
    
    // FAILSAFE: If the script owner doesn't have the calendar, force a subscription
    if (!cal) {
       cal = CalendarApp.subscribeToCalendar(calId);
    }
    
    if (!cal) {
       return ContentService.createTextOutput(JSON.stringify({ upcoming: [{title: "ERR: Cal Link Failed", date: ""}] })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 1. Check for Active Automated Sessions
    const todayEvents = cal.getEventsForDay(now);
    let scheduledSession = { active: false, type: "" };
    
    for (let i = 0; i < todayEvents.length; i++) {
      const ev = todayEvents[i];
      if (ev.getStartTime() <= now && ev.getEndTime() >= now) {
        const title = ev.getTitle().toUpperCase();
        if (title.indexOf("[MEET]") !== -1) {
          scheduledSession.active = true;
          scheduledSession.type = (now.getDay() === 0 || now.getDay() === 6) ? "Weekend" : "Weekday";
          break;
        } else if (title.indexOf("[OUTREACH]") !== -1) {
          scheduledSession.active = true;
          scheduledSession.type = "Outreach";
          break;
        } else if (title.indexOf("[COMPETITION]") !== -1) {
          scheduledSession.active = true;
          scheduledSession.type = "Competition";
          break;
        }
      }
    }
    
    // 2. Fetch the Upcoming Events Stream (Next 14 Days)
    const twoWeeksOut = new Date(now.getTime() + (14 * 24 * 60 * 60 * 1000));
    const futureEvents = cal.getEvents(now, twoWeeksOut);
    
    let upcoming = [];
    for (let i = 0; i < futureEvents.length; i++) {
      const ev = futureEvents[i];
      if (ev.getEndTime() > now) {
        let cleanTitle = ev.getTitle().replace(/\[.*?\]\s*/g, '').trim();
        upcoming.push({
          title: cleanTitle,
          date: ev.getStartTime().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        });
      }
      if (upcoming.length >= 3) break; 
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      active: scheduledSession.active,
      type: scheduledSession.type,
      upcoming: upcoming
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function testPermissions() {
  const calId = 'c_a246400a88a21fe4e3b65cc96f43ae4020788d8410fe2a1c572ab632d872a20a@group.calendar.google.com';
  CalendarApp.subscribeToCalendar(calId);
  Logger.log("Success");
}
```

4. Click **Deploy > New Deployment**.
5. Select **Web App** as the deployment type.
6. Set **Execute as** to **Me**.
7. Set **Who has access** to **Anyone**.
8. Click **Deploy**, authorize the permissions, and **copy the Web App URL** (you will need this in Step 4).

---

## 2. Google Calendar Integration
The system reads a Google Calendar to automatically start and stop meetings. You must link your specific team calendar to the Apps Script.

1. Open Google Calendar on the web.
2. Hover over your robotics team calendar on the left sidebar, click the **three dots**, and select **Settings and sharing**.
3. Scroll down to the **Integrate calendar** section and copy your **Calendar ID** (it usually looks like a long string of letters ending in `@group.calendar.google.com`).
4. Go back to your **Apps Script editor**. Inside the `doGet` function, find the variable named `calId` and replace the string with your copied Calendar ID.
5. **Crucial:** To grant the script permission to read your calendar, select the `testPermissions` function from the dropdown menu at the top of the Apps Script editor and click **Run**. Accept the Google security warning.
6. Re-deploy the script (Deploy > Manage Deployments > Pencil Icon > New Version > Deploy).

---

## 3. Firebase Realtime Database Setup
Firebase is used to keep the kiosk synchronized instantly across multiple devices and to manage the live roster.

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Create a new project named "Panther Kiosk".
3. Navigate to **Firestore Database** and click **Create Database**. Start in "Test Mode" (or configure your security rules appropriately).
4. Go to **Project Settings > General**, scroll down to "Your apps", and click the **Web `</>`** icon to add a web app.
5. Register the app and copy the `firebaseConfig` keys provided.

---

## 4. Local Installation & Configuration
Clone the repository and set up your secure environment variables.

### Clone the Repository
Open your terminal and run:
```bash
git clone [https://github.com/mrmarganski/kiosk.git](https://github.com/mrmarganski/kiosk.git)
cd kiosk
```

### Install Dependencies
Ensure you have Node.js installed, then run:
```bash
npm install
```

### Configure Environment Variables
Create a file named `.env` in the root directory of your project. **Never commit this file to GitHub.** Add the following variables, replacing the values with your specific Firebase config and Apps Script URL:

```text
VITE_FIREBASE_API_KEY=your_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id

# Admin Security
VITE_ADMIN_PIN=123456

# Google Sheets Integration
VITE_GS_WEBAPP_URL=[https://script.google.com/macros/s/your_script_id/exec](https://script.google.com/macros/s/your_script_id/exec)
```

---

## 5. Local Testing
Always verify your code locally before deploying to the tablet or web.

1. Build the project to verify structural integrity:
   ```bash
   npm run build
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
3. Open the `localhost` link provided in the terminal. Test the Admin login, manual check-in/out, and ensure the calendar feed loads correctly.

---

## 6. Deployment (Firebase Hosting)
To run this reliably on a tablet, host the application using Firebase Hosting.

1. Install the Firebase CLI tools globally on your machine:
   ```bash
   npm install -g firebase-tools
   ```
2. Log into your Google account:
   ```bash
   firebase login
   ```
3. Initialize hosting in your project directory:
   ```bash
   firebase init hosting
   ```
   * *Select "Use an existing project" and choose your Firebase project.*
   * *When asked for your public directory, type `dist`.*
   * *Configure as a single-page app: `Yes`.*
   * *Set up automatic builds with GitHub: `No`.*
4. Deploy to the web:
   ```bash
   firebase deploy
   ```

---

## 7. How to Use the System
Once deployed and running on your tablet, the system manages itself based on your calendar.

* **Automated Sessions:** The system reads your public Google Calendar. If it detects an event with the tags `[MEET]`, `[OUTREACH]`, or `[COMPETITION]` in the title, it will automatically activate the session status.
* **Auto-Sweep:** When the calendar event ends, the Kiosk will automatically check out any students who forgot to sign out, log their hours to Google Sheets, and reset to an `IDLE` state.
* **Admin Dashboard:** Tap the logo on the kiosk and enter your `VITE_ADMIN_PIN` to access live rosters, correct missing logs, manually override session states, or download backup CSVs.
