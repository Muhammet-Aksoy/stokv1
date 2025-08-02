#!/usr/bin/env python3
import sqlite3
import json
import shutil
import os
from datetime import datetime
import sys

def backup_database():
    try:
        # Veritabanı yolu
        db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'veriler', 'veritabani.db')
        backup_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'veriler', 'backups')
        
        # Backup klasörünü oluştur
        os.makedirs(backup_dir, exist_ok=True)
        
        # Backup dosya adı
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_path = os.path.join(backup_dir, f'backup_{timestamp}.db')
        
        # Veritabanını kopyala
        shutil.copy2(db_path, backup_path)
        
        # Veritabanına bağlan ve veri kontrolü yap
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Tablo sayılarını al
        tables = ['stok', 'satisGecmisi', 'musteriler', 'borclarim']
        table_counts = {}
        
        for table in tables:
            cursor.execute(f'SELECT COUNT(*) FROM {table}')
            count = cursor.fetchone()[0]
            table_counts[table] = count
        
        conn.close()
        
        result = {
            'success': True,
            'message': 'Veritabanı başarıyla yedeklendi',
            'backup_path': backup_path,
            'table_counts': table_counts,
            'timestamp': timestamp
        }
        
        print(json.dumps(result))
        
    except Exception as e:
        error_result = {
            'success': False,
            'error': str(e),
            'message': 'Veritabanı yedekleme başarısız'
        }
        print(json.dumps(error_result))

if __name__ == '__main__':
    backup_database()