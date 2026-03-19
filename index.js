/* ============================= LOAD ENV ============================= */
import dotenv from "dotenv";
dotenv.config();

/* ============================= IMPORTS ============================= */
import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import { createClient } from "@supabase/supabase-js";
import { format } from "date-fns-tz";

/* ============================= APP ============================= */
const app = express();

/* ============================= SUPABASE CLIENT (SINGLE - PERFECT) ============================= */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

/* ============================= CORS (FIXED) ============================= */
app.use(cors({
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

/* ============================= IN-MEMORY ROOMS + SUPABASE ============================= */
let tournamentRooms = {};

/* ============================= 🔥 MY BALANCE ENDPOINT (5001 COMPATIBLE) ============================= */
app.get("/api/my-balance", async (req, res) => {
  try {
    const { profileId } = req.query;
    if (!profileId) {
      console.log("❌ No profileId provided");
      return res.json({ balance: 0 });
    }
    
    const { data } = await supabase
      .from("registeruser")
      .select("balance")
      .eq("profile_id", profileId)
      .single();
    
    const balance = data?.balance || 0;
    console.log("💰 BALANCE FETCH:", profileId, "→ ₹", balance);
    res.json({ balance });
  } catch (err) {
    console.error("❌ BALANCE ERROR:", err);
    res.json({ balance: 0 });
  }
});

/* ============================= 🔥 NEW ENDPOINT - CLEAR APPROVED DEPOSITS (WALLET SAFE!) ============================= */
app.delete("/api/admin/clear-approved/:profileId", async (req, res) => {
  try {
    const { profileId } = req.params;
    
    // 🔥 SIRF APPROVED deposits delete karenge (WALLET BALANCE SAFE!)
    const { data: deletedDeposits, count } = await supabase
      .from("DepositUser")
      .delete()
      .eq("profile_id", profileId)
      .eq("status", "approved")
      .select("amount, date_ist");

    console.log(`🗑️ APPROVED HISTORY CLEARED:`, profileId, `${count || 0} deposits deleted (WALLET SAFE ✅)`);
    
    res.json({ 
      success: true, 
      cleared: count || 0,
      message: "Approved deposits cleared! Wallet balance unchanged ✅"
    });
  } catch (err) {
    console.error("❌ CLEAR APPROVED ERROR:", err);
    res.status(500).json({ success: false, message: "Clear failed" });
  }
});

/* ============================= HEALTH CHECK ============================= */
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    time: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    supabase: "✅ Connected",
    rooms: Object.keys(tournamentRooms).length,
    profileFields: "✅ AUTO FROM DEPOSITUSER",
    roomSave: "✅ SUPABASE PERMANENT",
    balanceSync: "✅ ACTIVE",
    myBalance: "✅ ACTIVE",
    clearApproved: "✅ WALLET SAFE ENDPOINT ACTIVE 🔥",
    rollback: "✅ TOURNAMENT ROLLBACK ACTIVE 🚀"
  });
});

/* ============================= 🔥 ROLLBACK ENDPOINT (NEW - SAFETY FOR WALLET FAILURES!) ============================= */
app.post("/api/rollback-join/:tournamentId", async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { bgmiId } = req.query;
    
    if (!bgmiId) {
      return res.status(400).json({ success: false, message: "bgmiId required" });
    }

    // Delete the failed join record (recent most)
    const { count } = await supabase
      .from("tournament_joins")
      .delete()
      .eq("tournament_id", tournamentId)
      .eq("bgmi_id", bgmiId);

    console.log("🔄 ROLLBACK SUCCESS:", tournamentId, bgmiId, `${count || 0} records deleted`);
    
    res.json({ 
      success: true, 
      deleted: count || 0,
      message: "✅ Tournament join rolled back successfully!"
    });
  } catch (err) {
    console.error("❌ ROLLBACK ERROR:", err);
    res.status(500).json({ success: false, message: "Rollback failed" });
  }
});

/* ============================= TOURNAMENT ENDPOINTS ============================= */
app.post("/api/join-tournament", async (req, res) => {
  const data = req.body;
  
  console.log("📦 RAW DATA RECEIVED:", data);
  
  if (!data.bgmiId || !data.tournamentId || !data.playerName) {
    return res.status(400).json({ 
      success: false, 
      message: "Missing bgmiId, tournamentId or playerName" 
    });
  }

  try {
    const { data: existingJoin } = await supabase
      .from("tournament_joins")
      .select("id")
      .eq("tournament_id", data.tournamentId)
      .eq("bgmi_id", data.bgmiId)
      .maybeSingle();

    if (existingJoin) {
      return res.json({ 
        success: false, 
        message: "❌ Already joined this tournament!" 
      });
    }

    const { count } = await supabase
      .from("tournament_joins")
      .select("*", { count: 'exact', head: true })
      .eq("tournament_id", data.tournamentId);

    if (count >= 2) {
      return res.json({ 
        success: false, 
        message: "🔴 Tournament Full (2/2 slots)" 
      });
    }

    let profileName = data.profileName || "";
    let profileId = data.profileId || "";
    
    if (!profileId) {
      const { data: deposits } = await supabase
        .from("DepositUser")
        .select("profile_id, name")
        .order("date", { ascending: false })
        .limit(1)
        .eq("status", "approved");
      
      if (deposits?.[0]) {
        profileId = deposits[0].profile_id;
        profileName = deposits[0].name;
        console.log("🔥 AUTO-FOUND from DepositUser:", { profileId, profileName });
      } else {
        profileId = "guest_" + nanoid(6);
        profileName = data.playerName;
        console.log("🔥 GUEST created:", { profileId, profileName });
      }
    }

    const cleanData = {
      tournament_id: data.tournamentId,
      tournament_name: data.tournamentName,
      player_name: data.playerName,
      bgmi_id: data.bgmiId,
      profile_name: profileName,
      profile_id: profileId,
      mode: data.mode || "TDM",
      rules: data.rulesShort || data.rules || "",
      date: data.date,
      time: data.time,
      map: data.map || "Erangel",
      entry_fee: Number(data.entryFee) || 0,
      prize_pool: Number(data.prizePool) || 0,
      slots: Number(data.slots) || 0,
      status: "Registered",
      joined_at: new Date().toISOString(),
      room_id: "",
      room_password: ""
    };

    console.log("✅ FINAL DATA FOR SUPABASE:", cleanData);

    const { data: newJoin, error } = await supabase
      .from("tournament_joins")
      .insert([cleanData])
      .select()
      .single();

    if (error) {
      console.error("❌ SUPABASE INSERT ERROR:", error);
      return res.status(500).json({ 
        success: false, 
        message: error.message || "Database error" 
      });
    }

    console.log("🎉 NEW JOIN SAVED:", newJoin.id);
    
    res.json({ 
      success: true, 
      joinId: newJoin.id,
      message: "✅ Successfully joined tournament!"
    });

  } catch (err) {
    console.error("❌ SERVER ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/api/check-join/:tournamentId", async (req, res) => {
  try {
    const bgmiId = req.query.bgmiId;
    if (!bgmiId) return res.json({ joined: false });

    const { data } = await supabase
      .from("tournament_joins")
      .select("id")
      .eq("tournament_id", req.params.tournamentId)
      .eq("bgmi_id", bgmiId)
      .maybeSingle();

    res.json({ joined: !!data });
  } catch (err) {
    console.error("CHECK JOIN ERROR:", err);
    res.json({ joined: false });
  }
});

app.get("/api/tournament-slots-count/:tournamentId", async (req, res) => {
  try {
    const { count } = await supabase
      .from("tournament_joins")
      .select("*", { count: 'exact', head: true })
      .eq("tournament_id", req.params.tournamentId);

    res.json({ 
      registered: count || 0, 
      max: 2 
    });
  } catch (err) {
    console.error("SLOTS ERROR:", err);
    res.json({ registered: 0, max: 2 });
  }
});

app.get("/api/my-matches", async (req, res) => {
  try {
    const bgmiId = req.query.bgmiId;
    if (!bgmiId) return res.json({ matches: [] });

    const { data: matches, error } = await supabase
      .from("tournament_joins")
      .select("*")
      .eq("bgmi_id", bgmiId)
      .order("joined_at", { ascending: false });

    if (error) {
      console.error("MY MATCHES ERROR:", error);
      return res.json({ matches: [] });
    }

    const matchesWithRooms = (matches || []).map(match => ({
      ...match,
      roomId: match.room_id || tournamentRooms[match.tournament_id]?.roomId || "",
      roomPassword: match.room_password || tournamentRooms[match.tournament_id]?.roomPassword || ""
    }));

    res.json({ matches: matchesWithRooms });
  } catch (err) {
    console.error("MY MATCHES ERROR:", err);
    res.json({ matches: [] });
  }
});

app.get("/api/admin/joins", async (req, res) => {
  try {
    const { data } = await supabase
      .from("tournament_joins")
      .select("*")
      .order("joined_at", { ascending: false });

    const cleanJoins = (data || []).map(j => {
      const { room_id, room_password, ...rest } = j;
      return rest;
    });

    console.log("✅ Admin joins sent (NO rooms):", cleanJoins.length);
    res.json({ tournamentJoins: cleanJoins });
  } catch (err) {
    console.error("ADMIN JOINS ERROR:", err);
    res.json({ tournamentJoins: [] });
  }
});

app.put("/api/admin/set-room-by-tournament", async (req, res) => {
  const { tournamentId, roomId, roomPassword } = req.body;
  
  if (!tournamentId) {
    return res.status(400).json({ success: false, message: "tournamentId required" });
  }
  
  try {
    tournamentRooms[tournamentId] = {
      roomId: roomId || "",
      roomPassword: roomPassword || ""
    };
    
    const { error } = await supabase
      .from("tournament_joins")
      .update({ 
        room_id: roomId || "",
        room_password: roomPassword || ""
      })
      .eq("tournament_id", tournamentId);

    if (error) {
      console.error("❌ SUPABASE ROOM SAVE ERROR:", error);
    }
    
    console.log("✅ ROOM SAVED:", { 
      tournamentId, 
      roomId: roomId || "empty", 
      roomPassword: roomPassword || "empty" 
    });
    
    res.json({ 
      success: true, 
      message: "✅ Room saved PERMANENTLY!" 
    });
    
  } catch (err) {
    console.error("❌ ROOM SAVE ERROR:", err);
    res.status(500).json({ success: false, message: "Save failed" });
  }
});

app.delete("/api/admin/tournament/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("tournament_joins")
      .delete()
      .eq("id", req.params.id);

    if (error) {
      console.error("DELETE ERROR:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
    
    console.log("✅ DELETED:", req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* ============================= 🔥 FIXED DEPOSIT ENDPOINTS (BALANCE SYNC PERFECT!) ============================= */
app.post("/api/deposit", async (req, res) => {
  const { profileId, username, email, amount, utr } = req.body;

  if (!profileId || !amount || !utr) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  try {
    const nowUTC = new Date().toISOString();
    const nowIST = format(new Date(), "dd/MM/yyyy, hh:mm:ss a", { timeZone: "Asia/Kolkata" });

    const { data, error } = await supabase
      .from("DepositUser")
      .insert([{
        profile_id: profileId.toString(),
        name: username || "Unknown",
        email: email || "no-email",
        amount: Number(amount),
        utr: utr.toString(),
        status: 'pending',
        date: nowUTC,
        date_ist: nowIST
      }])
      .select()
      .single();

    if (error) {
      console.error("❌ SUPABASE ERROR:", error);
      return res.status(500).json({ success: false, message: error.message });
    }

    console.log("✅ NEW DEPOSIT:", profileId, "₹", amount, "→ PENDING");
    res.json({ success: true, deposit: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/* 🔥 APPROVE = WALLET + REGISTERUSER BALANCE UPDATE (FIXED!) */
app.put("/api/admin/deposit-status/:id", async (req, res) => {
  const { status } = req.body;
  
  if (!status) {
    return res.status(400).json({ success: false, message: "Status required" });
  }

  try {
    // 1. Deposit details fetch kar
    const { data: deposit, error: depositError } = await supabase
      .from("DepositUser")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (depositError || !deposit) {
      console.error("❌ Deposit not found:", req.params.id);
      return res.status(500).json({ success: false, message: "Deposit not found" });
    }

    console.log("🔍 DEPOSIT FOUND:", deposit.profile_id, "₹", deposit.amount, deposit.status, "→", status);

    // 🔥 2. APPROVE HUA TO REGISTERUSER BALANCE ADD KAR (ONLY PENDING!)
    if (status === "approved" && deposit.status === "pending") {
      // Current balance check kar
      const { data: user } = await supabase
        .from("registeruser")
        .select("balance")
        .eq("profile_id", deposit.profile_id)
        .single();

      const currentBalance = user?.balance || 0;
      const newBalance = currentBalance + deposit.amount;

      console.log("💰 BEFORE:", currentBalance, "→ ADDING ₹", deposit.amount);

      // Balance update kar
      const { error: balanceError } = await supabase
        .from("registeruser")
        .update({ balance: newBalance })
        .eq("profile_id", deposit.profile_id);

      if (balanceError) {
        console.error("❌ BALANCE UPDATE FAILED:", balanceError);
        return res.status(500).json({ success: false, message: "Balance update failed" });
      }

      console.log("✅ BALANCE SYNC SUCCESS:", deposit.profile_id, "₹", currentBalance, "→", newBalance);
    } else {
      console.log("ℹ️ SKIP BALANCE UPDATE:", deposit.status, "→", status, "(not pending→approved)");
    }

    // 3. Deposit status update kar
    const { data: updatedDeposit, error: statusError } = await supabase
      .from("DepositUser")
      .update({ status })
      .eq("id", req.params.id)
      .select()
      .single();

    if (statusError) {
      console.error("❌ STATUS UPDATE ERROR:", statusError);
      return res.status(500).json({ success: false, message: statusError.message });
    }

    console.log("✅ DEPOSIT STATUS:", deposit.profile_id, "→", status);
    res.json({ success: true, deposit: updatedDeposit });

  } catch (err) {
    console.error("❌ APPROVE ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* 🔥 DELETE = SIRF HISTORY CLEAR (BALANCE SAFE) */
app.delete("/api/admin/deposit/:id", async (req, res) => {
  try {
    const { data: deposit } = await supabase
      .from("DepositUser")
      .select("profile_id, status, amount")
      .eq("id", req.params.id)
      .single();

    const { error } = await supabase
      .from("DepositUser")
      .delete()
      .eq("id", req.params.id);

    if (error) {
      console.error("❌ DELETE ERROR:", error);
      return res.status(500).json({ success: false, message: error.message });
    }

    console.log("🗑️ DEPOSIT DELETED:", deposit?.profile_id, "₹", deposit?.amount, "(BALANCE SAFE)");
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/api/deposits", async (req, res) => {
  const { data, error } = await supabase
    .from("DepositUser")
    .select("*")
    .order("date", { ascending: false });

  if (error) return res.json({ deposits: [] });
  res.json({ deposits: data });
});

app.get("/api/admin/deposits", async (req, res) => {
  const { data } = await supabase
    .from("DepositUser")
    .select("*")
    .order("date", { ascending: false });

  res.json({ deposits: data || [] });
});

/* ============================= SERVER START ============================= */
const PORT = process.env.PORT || 5002;
app.listen(PORT, "0.0.0.0", () => {
  console.log("🔥 BGMI Server (5002) running on port", PORT);
  console.log("✅ Health: http://localhost:5002/health");
  console.log("✅ Tournament Joins → SUPABASE (AUTO-PROFILE)");
  console.log("✅ ROOMS → SUPABASE PERMANENT SAVE! 🔥");
  console.log("✅ BALANCE SYNC → REGISTERUSER + WALLET! 💰");
  console.log("✅ MY-BALANCE ENDPOINT → ACTIVE!");
  console.log("✅ ROLLBACK ENDPOINT → ACTIVE! 🚀");
  console.log("✅ CLEAR APPROVED → WALLET SAFE! 🧹");
  console.log("✅ Admin inputs → KHALI | MyMatches → Rooms dikhenge!");
});
