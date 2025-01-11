const { Client, LocalAuth } = require('whatsapp-web.js'); // Import library whatsapp-web.js
const qrcode = require('qrcode-terminal'); // Import library qrcode-terminal
const Modbus = require('jsmodbus'); // Import library jsmodbus
const net = require('net'); // Import module net
const schedule = require('node-schedule'); // Import library node-schedule
const fs = require('fs'); // Import module fs

// Konfigurasi koneksi PLC
const PLC_HOST = '192.168.1.53'; // Ganti dengan alamat IP PLC Anda
const PLC_PORT = 502; // Port Modbus TCP default
const UNIT_ID = 1; // Ganti dengan Unit ID PLC Anda

// Alamat coil untuk setiap ruangan
const COIL_ADDRESS = {
  'tengah': 0, // Ganti dengan alamat coil ruang tengah di PLC
  'dapur': 1,  // Ganti dengan alamat coil ruang dapur di PLC
  'tamu': 2    // Ganti dengan alamat coil ruang tamu di PLC
};

// Nomor WhatsApp admin (ganti dengan nomor WhatsApp Anda)
const ADMIN_NUMBER = '123456789101@c.us'; // Contoh format nomor dengan kode negara

// Inisialisasi client WhatsApp
const client = new Client({
  authStrategy: new LocalAuth(), // Gunakan strategi autentikasi lokal
  puppeteer: {
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Sesuaikan path ke Chrome jika perlu
  }
});

// Penjadwalan
let schedules = {}; // Objek untuk menyimpan jadwal

// Path file untuk menyimpan data jadwal
const SCHEDULE_FILE = 'schedules.json';

// Fungsi untuk memuat data jadwal dari file
function loadSchedules() {
  try {
    // Jika file tidak ada, buat file baru
    if (!fs.existsSync(SCHEDULE_FILE)) {
      fs.writeFileSync(SCHEDULE_FILE, '{}');
    }

    const data = fs.readFileSync(SCHEDULE_FILE);
    const loadedSchedules = JSON.parse(data);
    // Aktifkan kembali jadwal yang sudah tersimpan
    for (const key in loadedSchedules) {
      const { ruangan, action, jam, menit } = loadedSchedules[key];
      schedules[key] = {
        job: schedule.scheduleJob({ hour: jam, minute: menit }, async () => {
          await controlPLC(action, ruangan, ADMIN_NUMBER);
          console.log(`Jadwal: Lampu ruang ${ruangan} ${action === 'nyala' ? 'dinyalakan' : 'dimatikan'} sesuai jadwal.`);
          client.sendMessage(ADMIN_NUMBER, `Jadwal: Lampu ruang ${ruangan} ${action === 'nyala' ? 'dinyalakan' : 'dimatikan'} sesuai jadwal.`);
        }),
        ruangan: ruangan,
        action: action,
        jam: jam,
        menit: menit
      };
    }
    console.log('Jadwal berhasil dimuat.');
  } catch (error) {
    console.error('Gagal memuat jadwal:', error);
  }
}

// Fungsi untuk menyimpan data jadwal ke file
function saveSchedules() {
  try {
    const dataToSave = {}; // Objek baru untuk menyimpan data yang akan disimpan
    for (const key in schedules) {
      const { ruangan, action, jam, menit } = schedules[key];
      dataToSave[key] = { ruangan, action, jam, menit }; // Simpan hanya data yang diperlukan
    }
    const data = JSON.stringify(dataToSave); // Stringify dataToSave, not schedules
    fs.writeFileSync(SCHEDULE_FILE, data);
    console.log('Jadwal berhasil disimpan.');
  } catch (error) {
    console.error('Gagal menyimpan jadwal:', error);
  }
}

// Generate QR code untuk login WhatsApp
client.on('qr', qr => {
  qrcode.generate(qr, { small: true }); // Tampilkan QR code di terminal
});

// Event ketika client WhatsApp siap
client.on('ready', () => {
  console.log('Client siap!');
  loadSchedules(); // Muat jadwal saat bot siap
});

// Fungsi untuk mengontrol PLC
async function controlPLC(action, ruangan, sender) {
  const socket = new net.Socket(); // Buat socket baru
  const modbusClient = new Modbus.client.TCP(socket, UNIT_ID); // Buat client Modbus TCP

  try {
    await new Promise((resolve, reject) => {
      socket.connect({ host: PLC_HOST, port: PLC_PORT }, resolve); // Koneksi ke PLC
      socket.on('error', reject); // Tangani error koneksi
    });

    const coilAddress = COIL_ADDRESS[ruangan];
    if (coilAddress !== undefined) {
      await modbusClient.writeSingleCoil(coilAddress, action === 'nyala'); // Kirim perintah ke PLC
      console.log(`Lampu ruang ${ruangan} ${action === 'nyala' ? 'dinyalakan' : 'dimatikan'}`);

      // Kirim laporan ke admin
      client.sendMessage(ADMIN_NUMBER, `Lampu ruang ${ruangan} ${action === 'nyala' ? 'dinyalakan' : 'dimatikan'} oleh ${sender}.`);
    } else {
      console.log(`Ruangan ${ruangan} tidak valid.`);
    }
  } catch (error) {
    console.error('Error controlling PLC:', error);
  } finally {
    socket.end(); // Tutup koneksi socket
  }
}

// Fungsi untuk membaca status lampu dari PLC
async function getLampStatus() {
  const socket = new net.Socket();
  const modbusClient = new Modbus.client.TCP(socket, UNIT_ID);

  const status = {}; // Objek untuk menyimpan status lampu

  try {
    await new Promise((resolve, reject) => {
      socket.connect({ host: PLC_HOST, port: PLC_PORT }, resolve);
      socket.on('error', reject);
    });

    for (const [ruangan, address] of Object.entries(COIL_ADDRESS)) {
      const response = await modbusClient.readCoils(address, 1); // Baca status coil dari PLC
      status[ruangan] = response.response._body.valuesAsArray[0] ? 'ON' : 'OFF'; // Ubah status menjadi ON/OFF
    }
  } catch (error) {
    console.error('Error reading PLC:', error);
    throw error;
  } finally {
    socket.end();
  }

  return status;
}

// Fungsi untuk mengontrol semua lampu
async function controlAllLights(action, sender) {
  const socket = new net.Socket();
  const modbusClient = new Modbus.client.TCP(socket, UNIT_ID);

  try {
    await new Promise((resolve, reject) => {
      socket.connect({ host: PLC_HOST, port: PLC_PORT }, resolve);
      socket.on('error', reject);
    });

    for (const ruangan of Object.keys(COIL_ADDRESS)) {
      const coilAddress = COIL_ADDRESS[ruangan];
      await modbusClient.writeSingleCoil(coilAddress, action === 'nyala');
      console.log(`Lampu ruang ${ruangan} ${action === 'nyala' ? 'dinyalakan' : 'dimatikan'}`);
    }

    // Kirim laporan ke admin setelah semua lampu diubah statusnya
    try {
      const status = await getLampStatus();
      const statusMessage = Object.entries(status)
        .map(([ruangan, state]) => `- Ruang ${ruangan}: ${state}`)
        .join('\n');
      client.sendMessage(ADMIN_NUMBER, `Semua lampu ${action === 'nyala' ? 'dinyalakan' : 'dimatikan'} oleh ${sender}.\nStatus lampu:\n${statusMessage}`);
    } catch (error) {
      console.error('Gagal membaca status lampu:', error);
    }
  } catch (error) {
    console.error('Error controlling all lights:', error);
    throw error;
  } finally {
    socket.end();
  }
}

// Event ketika menerima pesan
client.on('message', async (message) => {
  const command = message.body.toLowerCase(); // Ubah pesan menjadi huruf kecil
  const sender = message.from; // Dapatkan nomor pengirim pesan

  // Memeriksa apakah pengirim adalah admin
  if (sender === ADMIN_NUMBER) {
    if (command === '/start') {
      // Balas dengan daftar perintah
      const helpMessage = `
*Daftar Perintah Smart-Home*:

/start - Melihat daftar perintah
/nyala [ruangan] - Menyalakan lampu di ruangan tertentu
/mati [ruangan] - Mematikan lampu di ruangan tertentu
/nyala semua - Menyalakan semua lampu
/mati semua - Mematikan semua lampu
/jadwal [nyala/mati] [ruangan] [jam:menit] - Menjadwalkan nyala/mati lampu
/lihat jadwal - Melihat semua jadwal aktif
/hapus jadwal [ruangan] [nyala/mati] - Menghapus jadwal tertentu
/info - Melihat status lampu dan daftar ruangan
    `;
      message.reply(helpMessage);
    } else if (command === '/nyala semua') {
      try {
        await controlAllLights('nyala', sender);
        message.reply('Semua lampu dinyalakan.');
      } catch (error) {
        message.reply('Gagal menyalakan semua lampu. Periksa koneksi PLC.');
      }
    } else if (command === '/mati semua') {
      try {
        await controlAllLights('mati', sender);
        message.reply('Semua lampu dimatikan.');
      } catch (error) {
        message.reply('Gagal mematikan semua lampu. Periksa koneksi PLC.');
      }
    } else if (command.startsWith('/nyala ')) {
      const ruangan = command.substring(7); // Ambil nama ruangan setelah '/nyala '
      await controlPLC('nyala', ruangan, sender);
      message.reply(`Lampu ruang ${ruangan} dinyalakan.`);
    } else if (command.startsWith('/mati ')) {
      const ruangan = command.substring(6); // Ambil nama ruangan setelah '/mati '
      await controlPLC('mati', ruangan, sender);
      message.reply(`Lampu ruang ${ruangan} dimatikan.`);
    } else if (command.startsWith('/jadwal ')) {
      const [action, ruangan, waktu] = command.substring(8).split(' ');
      if (!['nyala', 'mati'].includes(action) || !(ruangan in COIL_ADDRESS)) {
        message.reply('Format tidak valid. Gunakan: /jadwal [nyala/mati] [ruangan] [HH:mm]');
        return;
      }

      const [jam, menit] = waktu.split(':');
      if (isNaN(jam) || isNaN(menit) || jam < 0 || jam > 23 || menit < 0 || menit > 59) {
        message.reply('Format waktu tidak valid. Gunakan format jam:menit.');
        return;
      }

      const key = `${ruangan}-${action}`;
      if (schedules[key] && schedules[key].job) { // Tambahkan pengecekan null pada schedules[key].job
        schedules[key].job.cancel(); // Batalkan job sebelumnya jika ada
      }

      const job = schedule.scheduleJob({ hour: parseInt(jam), minute: parseInt(menit) }, async () => {
        await controlPLC(action, ruangan, ADMIN_NUMBER);
        console.log(`Jadwal: Lampu ruang ${ruangan} ${action === 'nyala' ? 'dinyalakan' : 'dimatikan'} sesuai jadwal.`);

        // Kirim laporan ke admin
        client.sendMessage(ADMIN_NUMBER, `Jadwal: Lampu ruang ${ruangan} ${action === 'nyala' ? 'dinyalakan' : 'dimatikan'} sesuai jadwal.`);
      });

      // Simpan objek Job dan data jadwal
      schedules[key] = {
        job: job, // Simpan objek Job
        ruangan: ruangan,
        action: action,
        jam: parseInt(jam),
        menit: parseInt(menit)
      };

      saveSchedules();

      message.reply(`Jadwal ${action} lampu ruang ${ruangan} pada ${waktu} berhasil disimpan.`);

    } else if (command === '/lihat jadwal') {
      const jadwalList = Object.keys(schedules).map(key => {
        if (schedules[key].job) { // Tambahkan pengecekan null
          const nextRun = schedules[key].job.nextInvocation().toLocaleString();
          return `- Lampu ruang ${schedules[key].ruangan} akan ${schedules[key].action} pada ${nextRun}`;
        } else {
          return `- Jadwal untuk ruang ${schedules[key].ruangan} tidak valid.`;
        }
      });

      message.reply(jadwalList.length > 0 ? `Jadwal saat ini:\n${jadwalList.join('\n')}` : 'Tidak ada jadwal yang aktif.');

    } else if (command.startsWith('/hapus jadwal ')) {
      const [action, ruangan] = command.substring(14).split(' ');
      const key = `${action}-${ruangan}`;
      if (schedules[key] && schedules[key].job) { // Tambahkan pengecekan null pada schedules[key].job
        schedules[key].job.cancel(); // Batalkan job sebelum dihapus
        delete schedules[key];

        // Hapus data jadwal dari file
        saveSchedules();

        message.reply(`Jadwal ${action} lampu untuk ruangan ${ruangan} dihapus.`);
      } else {
        message.reply('Jadwal tidak ditemukan.');
      }
    } else if (command === '/info') {
      try {
        const status = await getLampStatus();
        const statusMessage = Object.entries(status)
          .map(([ruangan, state]) => `- Ruang ${ruangan}: ${state}`)
          .join('\n');
        message.reply(`Status lampu:\n${statusMessage}`);
      } catch (error) {
        message.reply('Gagal membaca status lampu. Periksa koneksi PLC.');
      }
    }
  } else {
    message.reply('Maaf, Anda tidak memiliki akses untuk mengontrol lampu.');
  }
});

// Inisialisasi client WhatsApp
client.initialize();