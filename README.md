# Panther Kiosk: Team 2064 Attendance System

The Panther Kiosk is a real-time, automated attendance tracking hub designed for robotics teams. It integrates Google Sheets for logging, Firebase for real-time state synchronization, and Google Calendar for automated meeting lifecycle management.

---

## 1. Google Sheets & Apps Script Setup
The kiosk uses Google Sheets as the ultimate database for attendance logs, making it easy to export, grade, or audit hours.

1. Create a new Google Sheet.
2. In the menu, click **Extensions > Apps Script**.
3. Delete any existing code and paste your `doPost` and `doGet` integration script.
4. Click **Deploy > New Deployment**.
5. Select **Web App** as the deployment type.
6. Set **Execute as** to **Me**.
7. Set **Who has access** to **Anyone**.
8. Click **Deploy**, authorize the permissions, and **copy the Web App URL** (you will need this in Step 3).

---

## 2. Firebase Realtime Database Setup
Firebase is used to keep the kiosk synchronized instantly across multiple devices and to manage the live roster.

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Create a new project named "Panther Kiosk".
3. Navigate to **Firestore Database** and click **Create Database**. Start in "Test Mode" (or configure your security rules appropriately).
4. Go to **Project Settings > General**, scroll down to "Your apps", and click the **Web `</>`** icon to add a web app.
5. Register the app and copy the `firebaseConfig` keys provided.

---

## 3. Local Installation & Configuration
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

## 4. Local Testing
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

## 5. Deployment (Firebase Hosting)
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
   * *Select "Use an existing project" and choose your Panther Kiosk project.*
   * *When asked for your public directory, type `dist`.*
   * *Configure as a single-page app: `Yes`.*
   * *Set up automatic builds with GitHub: `No`.*
4. Deploy to the web:
   ```bash
   firebase deploy
   ```

---

## 6. How to Use the System
Once deployed and running on your tablet, the system manages itself based on your calendar.

* **Automated Sessions:** The system reads your public Google Calendar. If it detects an event with the tags `[MEET]`, `[OUTREACH]`, or `[COMPETITION]` in the title, it will automatically activate the session status.
* **Auto-Sweep:** When the calendar event ends, the Kiosk will automatically check out any students who forgot to sign out, log their hours to Google Sheets, and reset to an `IDLE` state.
* **Admin Dashboard:** Tap the logo on the kiosk and enter your `VITE_ADMIN_PIN` to access live rosters, correct missing logs, manually override session states, or download backup CSVs.
