@echo off
title UGC Maker
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js belum terpasang di komputer ini.
  echo  Halaman download Node.js akan dibuka. Pilih versi 22 LTS,
  echo  pasang sampai selesai, lalu klik dua kali JALANKAN.bat lagi.
  echo.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b
)

if not exist "node_modules\" (
  echo.
  echo  Menyiapkan aplikasi untuk pertama kali. Tunggu beberapa menit...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  Persiapan gagal. Foto layar ini dan kirim ke Claude.
    pause
    exit /b
  )
)

echo.
echo  UGC Maker sedang berjalan. Browser akan terbuka otomatis.
echo  JANGAN tutup jendela hitam ini selama aplikasi dipakai.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
call npm start
pause
