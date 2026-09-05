'use strict';
/**
 * Seed data for the demo — Brickfields / KL Sentral, Kuala Lumpur.
 *
 * All timestamps are RELATIVE to `now` so the demo always starts in the same
 * state ("reported 40 min ago") no matter when the server is started.
 * Coordinates were geocoded from OpenStreetMap (Nominatim).
 */

const { hashPassword } = require('../lib/auth');

const H = 3600 * 1000;
const D = 24 * H;

const DEMO_PASSWORD = 'demo1234';

/**
 * role: 'helper' (normal people who contribute) | 'oku' (persons with disabilities who ask + report)
 * need: for OKU users — wheelchair | visual | elderly
 * All demo accounts share the password `demo1234`.
 */
const USERS = [
  { id: 'u_aisha', email: 'aisha@demo.my', name: 'Aisha Rahman', role: 'oku', need: 'wheelchair', peep: { mode: 'full', gender: 'female', body: 'body/dress', pose: 'pose/wheelchair', head: 'head/hijab', face: 'face/smile', facialHair: null, accessory: null, skin: '#d8a37e', hair: '#111111', cloth: '#5b6bdc', bg: '#f4f1ea' }, avatar: { hair: 'hijab', body: 'baju', item: 'none', glasses: 'none', aid: 'wheelchair' }, color: '#e9e5f5', points: 340, streak: 2, stats: { reports: 6, photos: 5, confirms: 9, disputes: 1, ramps: 1, lifts: 2, obstacles: 4, answers: 0, fastAnswers: 0, asks: 7, photoReports: 5 }, area: 'Brickfields' },
  { id: 'u_siti', email: 'siti@demo.my', name: 'Siti Nurhaliza', role: 'oku', need: 'visual', peep: { mode: 'bust', gender: 'female', body: 'body/turtleneck', pose: null, head: 'head/medium-bangs', face: 'face/calm', facialHair: null, accessory: 'accessories/sunglasses', skin: '#eac2a4', hair: '#111111', cloth: '#111111', bg: '#e8eef8' }, avatar: { hair: 'bob', body: 'dress', item: 'cane', glasses: 'shades', aid: 'none' }, color: '#f3e8f2', points: 510, streak: 4, stats: { reports: 7, photos: 4, confirms: 14, disputes: 2, ramps: 0, lifts: 1, obstacles: 5, answers: 0, fastAnswers: 0, asks: 12, photoReports: 4 }, area: 'Brickfields' },
  { id: 'u_ahmad', email: 'ahmad@demo.my', name: 'Ahmad Faiz', role: 'helper', need: null, peep: { mode: 'bust', gender: 'male', body: 'body/hoodie', pose: null, head: 'head/short-1', face: 'face/smile', facialHair: 'facial-hair/goatee', accessory: 'accessories/glasses', skin: '#eac2a4', hair: '#111111', cloth: '#5b6bdc', bg: '#e9e5f5' }, avatar: { hair: 'short', body: 'tee', item: 'phone', glasses: 'none', aid: 'none' }, color: '#e4f0ee', points: 1240, streak: 6, stats: { reports: 31, photos: 28, confirms: 40, disputes: 6, ramps: 8, lifts: 5, obstacles: 16, answers: 14, fastAnswers: 6, asks: 0, photoReports: 28 }, area: 'KL Sentral' },
  { id: 'u_mei', email: 'mei@demo.my', name: 'Mei Ling Tan', role: 'helper', need: null, peep: { mode: 'bust', gender: 'female', body: 'body/blazer-black-tee', pose: null, head: 'head/bun', face: 'face/cute', facialHair: null, accessory: 'accessories/glasses-2', skin: '#f6dcc8', hair: '#3b2a20', cloth: '#111111', bg: '#e4f0ee' }, avatar: { hair: 'bun', body: 'blazer', item: 'coffee', glasses: 'round', aid: 'none' }, color: '#fbe8e0', points: 860, streak: 3, stats: { reports: 18, photos: 17, confirms: 22, disputes: 3, ramps: 3, lifts: 4, obstacles: 9, answers: 9, fastAnswers: 4, asks: 0, photoReports: 17 }, area: 'Bangsar' },
  { id: 'u_raj', email: 'raj@demo.my', name: 'Rajesh Kumar', role: 'helper', need: null, peep: { mode: 'bust', gender: 'male', body: 'body/button-shirt', pose: null, head: 'head/short-2', face: 'face/smile-teeth', facialHair: 'facial-hair/full', accessory: null, skin: '#8d5a3b', hair: '#111111', cloth: '#2c9e8f', bg: '#fbe8e0' }, avatar: { hair: 'curly', body: 'shirt', item: 'phone', glasses: 'none', aid: 'none' }, color: '#e8eef8', points: 2450, streak: 11, stats: { reports: 52, photos: 50, confirms: 71, disputes: 9, ramps: 12, lifts: 9, obstacles: 27, answers: 31, fastAnswers: 18, asks: 0, photoReports: 50 }, area: 'Brickfields' },
  { id: 'u_farah', email: 'farah@demo.my', name: 'Farah Izzati', role: 'helper', need: null, peep: { mode: 'bust', gender: 'female', body: 'body/hoodie', pose: null, head: 'head/hijab', face: 'face/smile', facialHair: null, accessory: null, skin: '#d8a37e', hair: '#111111', cloth: '#ba98de', bg: '#f3e8f2' }, avatar: { hair: 'hijab', body: 'hoodie', item: 'bag', glasses: 'none', aid: 'none' }, color: '#f4f1ea', points: 420, streak: 1, stats: { reports: 9, photos: 8, confirms: 11, disputes: 1, ramps: 2, lifts: 1, obstacles: 4, answers: 5, fastAnswers: 2, asks: 0, photoReports: 8 }, area: 'Mid Valley' },
  { id: 'u_kumar', email: 'kumar@demo.my', name: 'Kumar Selvam', role: 'oku', need: 'elderly', peep: { mode: 'bust', gender: 'male', body: 'body/button-pocket-shirt', pose: null, head: 'head/gray-short', face: 'face/old', facialHair: 'facial-hair/mustache-thin', accessory: 'accessories/glasses', skin: '#b97e56', hair: '#7a7a7a', cloth: '#ffffff', bg: '#e5e5e5' }, avatar: { hair: 'bald', body: 'shirt', item: 'none', glasses: 'square', aid: 'cane' }, color: '#e5e5e5', points: 150, streak: 1, stats: { reports: 3, photos: 2, confirms: 4, disputes: 0, ramps: 1, lifts: 0, obstacles: 2, answers: 0, fastAnswers: 0, asks: 4, photoReports: 2 }, area: 'Brickfields' },
];

const REPORTS = [
  // ---------- KL Sentral hub ----------
  { id: 'r_lift_klsentral', type: 'lift_ok', lat: 3.13385, lng: 101.68660, place: 'KL Sentral – lift beside the stairs to the Nu Sentral walkway', note: 'Lift next to the escalators is working this morning – step-free way onto the walkway.', noteMs: 'Lif di sebelah eskalator berfungsi pagi ini – laluan tanpa tangga ke jejantas.', by: 'u_mei', ageH: 2, photo: null, confirms: [] },
  { id: 'r_staff_klsentral', type: 'staff', lat: 3.13445, lng: 101.68660, place: 'KL Sentral – customer service counter', note: 'Staff will escort wheelchair users to the platform if you ask at the counter.', noteMs: 'Kakitangan akan mengiringi pengguna kerusi roda ke platform jika diminta di kaunter.', by: 'u_aisha', ageH: 5, photo: null, confirms: ['u_raj'] },
  { id: 'r_parking_klsentral', type: 'parking_blocked', lat: 3.13400, lng: 101.68580, place: 'KL Sentral – OKU parking bays, Level 1', note: 'Delivery van parked across the OKU bay.', noteMs: 'Van penghantaran diparkir melintang petak OKU.', by: 'u_ahmad', ageH: 6, photo: '/seed-photos/parking-blocked.jpg', confirms: [] },
  { id: 'r_entrance_hilton', type: 'entrance', lat: 3.13527, lng: 101.68576, place: 'Hilton KL – lobby entrance', note: 'Step-free entrance via the taxi drop-off ramp.', noteMs: 'Pintu masuk tanpa tangga melalui tanjakan kawasan turun teksi.', by: 'u_raj', ageH: 24, photo: '/seed-photos/ramp.jpg', confirms: [] },
  { id: 'r_lift_muzium', type: 'lift_ok', lat: 3.13710, lng: 101.68738, place: 'MRT Muzium Negara – street lift', note: 'Street-level lift working, entrance B.', noteMs: 'Lif aras jalan berfungsi, pintu masuk B.', by: 'u_siti', ageH: 1, photo: '/seed-photos/lift-working.jpg', confirms: ['u_ahmad'] },
  // ---------- Nu Sentral ----------
  { id: 'r_ramp_nusentral', type: 'ramp', lat: 3.13328, lng: 101.68699, place: 'Nu Sentral – Jalan Tun Sambanthan entrance', note: 'Good ramp with handrails at the main entrance.', noteMs: 'Tanjakan baik dengan pemegang tangan di pintu masuk utama.', by: 'u_ahmad', ageH: 72, photo: '/seed-photos/ramp.jpg', confirms: ['u_aisha', 'u_mei'] },
  { id: 'r_toilet_nusentral', type: 'toilet', lat: 3.13340, lng: 101.68720, place: 'Nu Sentral – Level 2 OKU toilet', note: 'Clean, wide door, grab bars. Ask security for the key.', noteMs: 'Bersih, pintu lebar, palang pemegang. Minta kunci dari pengawal.', by: 'u_aisha', ageH: 48, photo: '/seed-photos/toilet.jpg', confirms: ['u_siti', 'u_raj'] },
  // ---------- KL Sentral Monorail ----------
  { id: 'r_lift_monorail', type: 'lift_broken', lat: 3.13268, lng: 101.68790, place: 'KL Sentral Monorail – street lift', note: 'Lift out of order, sign says "LIF ROSAK". Only escalator and stairs.', noteMs: 'Lif rosak, ada notis "LIF ROSAK". Hanya eskalator dan tangga.', by: 'u_raj', ageH: 3, photo: '/seed-photos/lift-broken.jpg', confirms: [] },
  // ---------- Jalan Tun Sambanthan corridor (the demo route) ----------
  { id: 'r_kerb_tunsambanthan', type: 'kerb_blocked', lat: 3.13306, lng: 101.68956, place: 'Jalan Tun Sambanthan – kerb ramp at the Jalan Tun Sambanthan 4 junction', note: 'Three motorcycles parked on the kerb ramp. No way down for a wheelchair.', noteMs: 'Tiga motosikal diparkir atas tanjakan kerb. Kerusi roda tak boleh turun.', by: 'u_aisha', ageH: 0.67, photo: '/seed-photos/kerb-blocked.jpg', confirms: ['u_ahmad'] },
  { id: 'r_tactile_tunsambanthan', type: 'tactile', lat: 3.13330, lng: 101.68900, place: 'Jalan Tun Sambanthan – tactile path (Brickfields blind-friendly zone)', note: 'Yellow tactile strip continuous from Nu Sentral to Jalan Tebing.', noteMs: 'Jalur sentuh kuning bersambung dari Nu Sentral hingga Jalan Tebing.', by: 'u_siti', ageH: 144, photo: '/seed-photos/tactile.jpg', confirms: ['u_raj'] },
  { id: 'r_pavement_thambipillay', type: 'pavement', lat: 3.13277, lng: 101.68875, place: 'Jalan Thambipillay – pavement outside the shophouses', note: 'Broken slabs and a tilted drain cover. Passable but risky.', noteMs: 'Papak pecah dan penutup longkang senget. Boleh lalu tapi berisiko.', by: 'u_mei', ageH: 30, photo: '/seed-photos/pavement.jpg', confirms: [] },
  { id: 'r_entrance_ymca', type: 'entrance', lat: 3.13343, lng: 101.68969, place: 'YMCA KL – Jalan Padang Belia entrance', note: 'Level entrance from the car park side.', noteMs: 'Pintu masuk rata dari sebelah tempat letak kereta.', by: 'u_ahmad', ageH: 24, photo: '/seed-photos/ramp.jpg', confirms: [] },
  { id: 'r_crossing_tebing', type: 'crossing', lat: 3.13240, lng: 101.69000, place: 'Jalan Tun Sambanthan / Jalan Tebing crossing', note: 'Audible signal + tactile studs, both sides.', noteMs: 'Isyarat berbunyi + stud sentuh, kedua-dua belah.', by: 'u_siti', ageH: 12, photo: '/seed-photos/tactile.jpg', confirms: [] },
  { id: 'r_steps_berhala', type: 'steps_only', lat: 3.13013, lng: 101.68803, place: 'Jalan Berhala – clinic entrance', note: 'Five steps, no ramp, no handrail.', noteMs: 'Lima anak tangga, tiada tanjakan, tiada pemegang.', by: 'u_raj', ageH: 480, photo: '/seed-photos/steps-only.jpg', confirms: ['u_mei'] },
  { id: 'r_construction_tebing', type: 'construction', lat: 3.13299, lng: 101.69218, place: 'Jalan Tebing – footpath near the river', note: 'Hoarding across the whole footpath, pedestrians pushed onto the road.', noteMs: 'Penghadang merentangi seluruh laluan, pejalan kaki terpaksa guna jalan raya.', by: 'u_ahmad', ageH: 20, photo: '/seed-photos/construction.jpg', confirms: [] },
  { id: 'r_tactile_blocked_mab', type: 'tactile_blocked', lat: 3.13230, lng: 101.69120, place: 'Jalan Tebing – outside Malaysian Association for the Blind', note: 'Food stall set up on top of the tactile path.', noteMs: 'Gerai makanan didirikan di atas jalur sentuh.', by: 'u_siti', ageH: 0.42, photo: '/seed-photos/kerb-blocked.jpg', confirms: [] },
  // ---------- Wider KL ----------
  { id: 'r_lift_pasarseni', type: 'lift_broken', lat: 3.14246, lng: 101.69531, place: 'LRT Pasar Seni – lift to concourse', note: 'Lift stuck on concourse level, staff say technician coming.', noteMs: 'Lif tersangkut di aras konkos, kakitangan kata juruteknik akan datang.', by: 'u_mei', ageH: 1, photo: '/seed-photos/lift-broken.jpg', confirms: ['u_raj'] },
  { id: 'r_construction_centralmarket', type: 'construction', lat: 3.14408, lng: 101.69545, place: 'Central Market – Jalan Hang Kasturi footpath', note: 'Footpath dug up for cabling works.', noteMs: 'Laluan digali untuk kerja kabel.', by: 'u_raj', ageH: 72, photo: '/seed-photos/construction.jpg', confirms: [] },
  { id: 'r_ramp_midvalley', type: 'ramp', lat: 3.11766, lng: 101.67737, place: 'Mid Valley Megamall – North Court entrance', note: 'Wide ramp, automatic doors.', noteMs: 'Tanjakan lebar, pintu automatik.', by: 'u_aisha', ageH: 48, photo: '/seed-photos/ramp.jpg', confirms: ['u_ahmad', 'u_mei'] },
  { id: 'r_lift_masjidjamek', type: 'lift_broken', lat: 3.14943, lng: 101.69634, place: 'LRT Masjid Jamek – Kelana Jaya line lift', note: 'Lift not responding to button.', noteMs: 'Lif tidak bertindak balas apabila butang ditekan.', by: 'u_ahmad', ageH: 9, photo: '/seed-photos/lift-broken.jpg', confirms: [] },
  { id: 'r_kerb_bangsar', type: 'kerb_blocked', lat: 3.12761, lng: 101.67910, place: 'LRT Bangsar – kerb ramp at bus stop', note: 'Car parked on the kerb ramp.', noteMs: 'Kereta diparkir atas tanjakan kerb.', by: 'u_mei', ageH: 14, photo: null, confirms: [] },
  { id: 'r_toilet_bukitbintang', type: 'toilet', lat: 3.14779, lng: 101.71087, place: 'MRT Bukit Bintang – paid area OKU toilet', note: 'OKU toilet next to the customer service office.', noteMs: 'Tandas OKU bersebelahan pejabat khidmat pelanggan.', by: 'u_siti', ageH: 120, photo: '/seed-photos/toilet.jpg', confirms: ['u_aisha'] },
  { id: 'r_pavement_merdeka', type: 'pavement', lat: 3.14786, lng: 101.69395, place: 'Dataran Merdeka – Jalan Raja pavement', note: 'Uneven bricks along the padang side.', noteMs: 'Bata tidak rata di sepanjang sebelah padang.', by: 'u_raj', ageH: 72, photo: '/seed-photos/pavement.jpg', confirms: [] },
  // ---------- Cyberjaya (pilot area 2 — the live demo location) ----------
  { id: 'r_ramp_dpulze', type: 'ramp', lat: 2.92190, lng: 101.65090, place: 'DPulze Shopping Centre – main entrance', note: 'Wide ramp with handrails to the right of the main doors, automatic doors.', noteMs: 'Tanjakan lebar dengan pemegang tangan di kanan pintu utama, pintu automatik.', by: 'u_mei', ageH: 6, photo: '/seed-photos/ramp.jpg', confirms: [] },
  { id: 'r_toilet_dpulze', type: 'toilet', lat: 2.92225, lng: 101.65130, place: 'DPulze – OKU toilet, Ground floor near Village Grocer', note: 'Accessible toilet open, no key needed.', noteMs: 'Tandas OKU dibuka, tiada kunci diperlukan.', by: 'u_ahmad', ageH: 20, photo: null, confirms: [] },
  { id: 'r_lift_shaftsbury', type: 'lift_broken', lat: 2.92330, lng: 101.66170, place: 'Shaftsbury Square – lift block B', note: 'Lift B out of order since yesterday, use lift A near the food court.', noteMs: 'Lif B rosak sejak semalam, guna lif A berhampiran medan selera.', by: 'u_raj', ageH: 14, photo: '/seed-photos/lift-broken.jpg', confirms: [] },
  { id: 'r_crossing_persiaran_apec', type: 'crossing', lat: 2.92260, lng: 101.65300, place: 'Persiaran APEC – crossing to DPulze', note: 'Signalised crossing with audible beeps and dropped kerbs both sides.', noteMs: 'Lintasan berisyarat dengan bunyi dan kerb rendah di kedua-dua belah.', by: 'u_farah', ageH: 40, photo: null, confirms: [] },
  { id: 'r_parking_cyber6', type: 'parking', lat: 2.92110, lng: 101.65460, place: 'City University – OKU parking bays', note: 'Two OKU bays beside the lift lobby, usually free before 9am.', noteMs: 'Dua petak OKU di sebelah lobi lif, biasanya kosong sebelum 9 pagi.', by: 'u_mei', ageH: 60, photo: null, confirms: [] },
  { id: 'r_pavement_cyber_hosp', type: 'pavement', lat: 2.92080, lng: 101.63220, place: 'Hospital Cyberjaya – pavement along Persiaran Bestari', note: 'Broken paving slabs near the bus stop, narrow for wheelchairs.', noteMs: 'Papak lantai pecah berhampiran perhentian bas, sempit untuk kerusi roda.', by: 'u_ahmad', ageH: 90, photo: '/seed-photos/pavement.jpg', confirms: [] },
  { id: 'r_tactile_mmu', type: 'tactile', lat: 2.92790, lng: 101.64260, place: 'MMU Cyberjaya – main gate to bus stop', note: 'Tactile paving continuous from the gate to the bus stop.', noteMs: 'Jalur sentuh berterusan dari pintu pagar ke perhentian bas.', by: 'u_raj', ageH: 120, photo: null, confirms: [] },
  { id: 'r_steps_gem', type: 'steps_only', lat: 2.92230, lng: 101.63500, place: 'Gem In Mall – side entrance', note: 'Side entrance has steps only; use the main entrance ramp.', noteMs: 'Pintu sisi hanya ada tangga; guna tanjakan pintu utama.', by: 'u_farah', ageH: 150, photo: '/seed-photos/steps-only.jpg', confirms: [] },
  { id: 'r_ramp_um', type: 'ramp', lat: 3.12576, lng: 101.65588, place: 'Universiti Malaya – main library entrance', note: 'Ramp on the left of the main steps.', noteMs: 'Tanjakan di sebelah kiri tangga utama.', by: 'u_mei', ageH: 200, photo: '/seed-photos/ramp.jpg', confirms: [] },
];

/**
 * Check requests: an OKU user asks "can someone check X for me?".
 * status: open | answered | closed. Helpers answer with yes/no + note (+ photo) and earn points.
 */
const REQUESTS = [
  { id: 'q_dpulze_lift', by: 'u_aisha', need: 'wheelchair', lat: 2.92207, lng: 101.65112, place: 'DPulze Shopping Centre, Cyberjaya', question: 'Is the lift from the ground floor to the cinema level working today? I want to catch the 8pm show.', questionMs: 'Adakah lif dari tingkat bawah ke aras pawagam berfungsi hari ini? Saya nak tonton wayang jam 8 malam.', ageH: 0.2, urgency: 'today', status: 'open', answers: [] },
  { id: 'q_shaftsbury_toilet', by: 'u_kumar', need: 'elderly', lat: 2.92327, lng: 101.66191, place: 'Shaftsbury Square, Cyberjaya', question: 'Is there an accessible toilet with grab bars near the food court, and is it clean?', questionMs: 'Adakah tandas OKU dengan palang pegangan berhampiran medan selera, dan adakah ia bersih?', ageH: 0.8, urgency: 'today', status: 'open', answers: [] },
  { id: 'q_hospital_cyber_ramp', by: 'u_siti', need: 'visual', lat: 2.92045, lng: 101.63159, place: 'Hospital Cyberjaya, main entrance', question: 'Is the tactile path from the bus stop to the main entrance clear of parked motorcycles?', questionMs: 'Adakah jalur sentuh dari perhentian bas ke pintu utama bebas daripada motosikal yang diparkir?', ageH: 3, urgency: 'this_week', status: 'open', answers: [] },
  { id: 'q_cyber6_bus', by: 'u_aisha', need: 'wheelchair', lat: 2.92300, lng: 101.65426, place: 'City University bus stop, Persiaran Multimedia', question: 'Does the bus stop have a dropped kerb so I can board the ramp bus?', questionMs: 'Adakah perhentian bas ini ada kerb rendah supaya saya boleh naik bas bertanjak?', ageH: 6, urgency: 'this_week', status: 'open', answers: [] },
  { id: 'q_lift_pasarseni', by: 'u_aisha', need: 'wheelchair', lat: 3.14246, lng: 101.69531, place: 'LRT Pasar Seni', question: 'Is the lift to the concourse working today? I have a hospital appointment at 3 pm and need to change to the MRT here.', questionMs: 'Adakah lif ke konkos berfungsi hari ini? Saya ada temu janji hospital jam 3 petang dan perlu tukar ke MRT di sini.', ageH: 0.35, urgency: 'today', status: 'open', answers: [] },
  { id: 'q_toilet_nusentral', by: 'u_kumar', need: 'elderly', lat: 3.13340, lng: 101.68720, place: 'Nu Sentral, Level 2', question: 'Is the OKU toilet on Level 2 open, or do I still need to ask security for a key?', questionMs: 'Adakah tandas OKU di Aras 2 dibuka, atau saya masih perlu minta kunci dari pengawal?', ageH: 1.2, urgency: 'today', status: 'open', answers: [] },
  { id: 'q_tactile_mab', by: 'u_siti', need: 'visual', lat: 3.13230, lng: 101.69120, place: 'Jalan Tebing, outside MAB', question: 'Has the food stall on the tactile path outside MAB been moved? I walk this way every morning.', questionMs: 'Adakah gerai makanan di atas jalur sentuh di luar MAB sudah dialihkan? Saya lalu sini setiap pagi.', ageH: 2.5, urgency: 'this_week', status: 'open', answers: [] },
  { id: 'q_kerb_bangsar', by: 'u_aisha', need: 'wheelchair', lat: 3.12761, lng: 101.67910, place: 'LRT Bangsar bus stop', question: 'Is the kerb ramp at the bus stop still blocked by a parked car?', questionMs: 'Adakah tanjakan kerb di perhentian bas masih dihalang kereta?', ageH: 5, urgency: 'this_week', status: 'open', answers: [] },
  { id: 'q_midvalley_parking', by: 'u_kumar', need: 'elderly', lat: 3.11766, lng: 101.67737, place: 'Mid Valley Megamall, North Court', question: 'Are there benches to rest between the North Court entrance and the cinema? I cannot walk far without sitting.', questionMs: 'Adakah bangku untuk berehat antara pintu masuk North Court dan pawagam? Saya tak boleh berjalan jauh tanpa duduk.', ageH: 8, urgency: 'whenever', status: 'open', answers: [] },
  { id: 'q_muzium_lift', by: 'u_siti', need: 'visual', lat: 3.13710, lng: 101.68738, place: 'MRT Muzium Negara, entrance B', question: 'Does the street lift at entrance B have audio floor announcements?', questionMs: 'Adakah lif jalan di pintu masuk B mempunyai pengumuman audio tingkat?', ageH: 26, urgency: 'whenever', status: 'answered', answers: [{ by: 'u_ahmad', verdict: 'yes', note: 'Yes – it announces "Street level" and "Concourse" in Malay and English. Buttons have braille.', ageH: 24.6, photo: null, thanked: true }] },
  { id: 'q_hilton_entrance', by: 'u_aisha', need: 'wheelchair', lat: 3.13527, lng: 101.68576, place: 'Hilton KL', question: 'Can I get from the taxi drop-off to the lobby without steps?', questionMs: 'Bolehkah saya dari kawasan turun teksi ke lobi tanpa tangga?', ageH: 30, urgency: 'today', status: 'answered', answers: [{ by: 'u_raj', verdict: 'yes', note: 'Yes, there is a ramp on the right side of the drop-off. Doormen will help with the heavy door.', ageH: 29.6, photo: '/seed-photos/ramp.jpg', thanked: true }] },
  { id: 'q_berhala_clinic', by: 'u_kumar', need: 'elderly', lat: 3.13013, lng: 101.68803, place: 'Klinik on Jalan Berhala', question: 'Is there a handrail on the steps at the clinic entrance?', questionMs: 'Adakah pemegang tangan di tangga pintu masuk klinik?', ageH: 50, urgency: 'this_week', status: 'answered', answers: [{ by: 'u_farah', verdict: 'no', note: 'No handrail and five steep steps. The pharmacy next door has a level entrance and can call the doctor down.', ageH: 47, photo: '/seed-photos/steps-only.jpg', thanked: false }] },
];

const TRANSACTIONS = [
  { userId: 'u_raj', type: 'report', amount: 15, ageH: 1, description: 'Reported lift broken – LRT Pasar Seni' },
  { userId: 'u_raj', type: 'confirm', amount: 5, ageH: 1, description: 'Confirmed lift broken – LRT Pasar Seni' },
  { userId: 'u_mei', type: 'report', amount: 15, ageH: 1, description: 'Reported lift broken – LRT Pasar Seni' },
  { userId: 'u_mei', type: 'report', amount: 5, ageH: 2, description: 'Reported lift working – KL Sentral (no photo)' },
  { userId: 'u_aisha', type: 'report', amount: 15, ageH: 0.67, description: 'Reported kerb ramp blocked – Jalan Tun Sambanthan' },
  { userId: 'u_ahmad', type: 'confirm', amount: 5, ageH: 0.5, description: 'Confirmed kerb ramp blocked – Jalan Tun Sambanthan' },
  { userId: 'u_siti', type: 'report', amount: 15, ageH: 0.42, description: 'Reported tactile path obstructed – Jalan Tebing' },
  { userId: 'u_siti', type: 'report', amount: 10, ageH: 1, description: 'Reported lift working – MRT Muzium Negara' },
  { userId: 'u_ahmad', type: 'confirm', amount: 5, ageH: 1, description: 'Confirmed lift working – MRT Muzium Negara' },
  { userId: 'u_ahmad', type: 'report', amount: 15, ageH: 6, description: 'Reported OKU parking blocked – KL Sentral' },
  { userId: 'u_raj', type: 'report', amount: 15, ageH: 3, description: 'Reported lift broken – KL Sentral Monorail' },
  { userId: 'u_ahmad', type: 'report', amount: 15, ageH: 9, description: 'Reported lift broken – LRT Masjid Jamek' },
  { userId: 'u_ahmad', type: 'answer', amount: 35, ageH: 24.6, description: 'Answered Siti – MRT Muzium Negara lift audio' },
  { userId: 'u_raj', type: 'answer', amount: 45, ageH: 29.6, description: 'Answered Aisha – Hilton KL entrance' },
  { userId: 'u_farah', type: 'answer', amount: 35, ageH: 47, description: 'Answered Kumar – Jalan Berhala clinic' },
  { userId: 'u_ahmad', type: 'report', amount: 15, ageH: 20, description: 'Reported footpath closed – Jalan Tebing' },
  { userId: 'u_mei', type: 'report', amount: 15, ageH: 30, description: 'Reported damaged pavement – Jalan Thambipillay' },
  { userId: 'u_raj', type: 'report', amount: 10, ageH: 24, description: 'Reported step-free entrance – Hilton KL' },
  { userId: 'u_ahmad', type: 'report', amount: 10, ageH: 24, description: 'Reported step-free entrance – YMCA' },
  { userId: 'u_raj', type: 'confirm', amount: 5, ageH: 40, description: 'Confirmed OKU toilet – Nu Sentral' },
  { userId: 'u_siti', type: 'confirm', amount: 5, ageH: 44, description: 'Confirmed OKU toilet – Nu Sentral' },
  { userId: 'u_aisha', type: 'confirm', amount: 5, ageH: 60, description: 'Confirmed ramp – Nu Sentral' },
  { userId: 'u_mei', type: 'confirm', amount: 5, ageH: 66, description: 'Confirmed ramp – Nu Sentral' },
  { userId: 'u_aisha', type: 'report', amount: 10, ageH: 48, description: 'Reported OKU toilet – Nu Sentral' },
  { userId: 'u_farah', type: 'confirm', amount: 5, ageH: 70, description: 'Confirmed ramp – Mid Valley' },
  { userId: 'u_raj', type: 'dispute', amount: 15, ageH: 100, description: 'Disputed outdated ramp report – Bangsar' },
];

function buildSeed(now = Date.now()) {
  const pw = hashPassword(DEMO_PASSWORD);
  const users = USERS.map((u) => ({ ...u, password: pw, stats: { ...u.stats }, createdAt: now - 30 * D, badges: [], lastActiveDay: null, notifications: [], thanks: 0 }));
  const reports = REPORTS.map((r) => {
    const createdAt = now - r.ageH * H;
    const verifiedAt = r.verifiedAgoH != null ? now - r.verifiedAgoH * H : createdAt;
    return {
      id: r.id, type: r.type, lat: r.lat, lng: r.lng, place: r.place, note: r.note, noteMs: r.noteMs || null,
      photo: r.photo || null, photoCheck: r.photo ? { ok: true, enabled: false, source: 'seed', summary: 'Seed photo' } : null,
      by: r.by, createdAt, lastVerifiedAt: verifiedAt,
      confirmations: (r.confirms || []).map((uid, i) => ({ userId: uid, at: createdAt + (i + 1) * 10 * 60 * 1000, onsite: true })),
      disputes: [],
      history: [{ kind: 'created', by: r.by, at: createdAt }, ...(r.confirms || []).map((uid, i) => ({ kind: 'confirmed', by: uid, at: createdAt + (i + 1) * 10 * 60 * 1000, onsite: true }))],
      removed: false,
    };
  });
  const requests = REQUESTS.map((q) => ({
    id: q.id, by: q.by, need: q.need, lat: q.lat, lng: q.lng, place: q.place, question: q.question, questionMs: q.questionMs || null,
    urgency: q.urgency, status: q.status, createdAt: now - q.ageH * H,
    answers: (q.answers || []).map((a, i) => ({ id: `${q.id}_a${i}`, by: a.by, verdict: a.verdict, note: a.note, photo: a.photo || null, at: now - a.ageH * H, thanked: !!a.thanked, points: 35 })),
  }));
  const transactions = TRANSACTIONS.map((t, i) => ({ id: `t_seed_${i}`, userId: t.userId, type: t.type, amount: t.amount, description: t.description, at: now - t.ageH * H }));
  return { users, reports, requests, transactions, sessions: {}, seededAt: now };
}

module.exports = { buildSeed, DEMO_PASSWORD, USERS };
