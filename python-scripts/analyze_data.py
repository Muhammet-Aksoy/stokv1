#!/usr/bin/env python3
import sqlite3
import json
import os
from datetime import datetime, timedelta

def analyze_data():
    try:
        # Veritabanı yolu
        db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'veriler', 'veritabani.db')
        
        # Veritabanına bağlan
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Analiz verilerini topla
        analysis = {}
        
        # Toplam stok sayısı
        cursor.execute('SELECT COUNT(*) FROM stok')
        total_stock = cursor.fetchone()[0]
        analysis['total_stock'] = total_stock
        
        # Toplam stok değeri
        cursor.execute('SELECT SUM(miktar * alisFiyati) FROM stok')
        total_stock_value = cursor.fetchone()[0] or 0
        analysis['total_stock_value'] = total_stock_value
        
        # Toplam müşteri sayısı
        cursor.execute('SELECT COUNT(*) FROM musteriler')
        total_customers = cursor.fetchone()[0]
        analysis['total_customers'] = total_customers
        
        # Bu ay satış sayısı
        current_month = datetime.now().strftime('%Y-%m')
        cursor.execute('SELECT COUNT(*) FROM satisGecmisi WHERE tarih LIKE ?', (f'{current_month}%',))
        monthly_sales = cursor.fetchone()[0]
        analysis['monthly_sales'] = monthly_sales
        
        # Bu ay satış tutarı
        cursor.execute('SELECT SUM(toplam) FROM satisGecmisi WHERE tarih LIKE ?', (f'{current_month}%',))
        monthly_revenue = cursor.fetchone()[0] or 0
        analysis['monthly_revenue'] = monthly_revenue
        
        # Toplam borç
        cursor.execute('SELECT SUM(tutar) FROM borclarim')
        total_debt = cursor.fetchone()[0] or 0
        analysis['total_debt'] = total_debt
        
        # En çok satılan ürünler (son 30 gün)
        thirty_days_ago = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
        cursor.execute('''
            SELECT s.barkod, st.ad, SUM(s.miktar) as total_sold
            FROM satisGecmisi s
            JOIN stok st ON s.barkod = st.barkod
            WHERE s.tarih >= ?
            GROUP BY s.barkod
            ORDER BY total_sold DESC
            LIMIT 5
        ''', (thirty_days_ago,))
        top_products = cursor.fetchall()
        analysis['top_products'] = [{'barkod': row[0], 'ad': row[1], 'total_sold': row[2]} for row in top_products]
        
        # Stok durumu (düşük stoklu ürünler)
        cursor.execute('''
            SELECT barkod, ad, miktar
            FROM stok
            WHERE miktar <= 10
            ORDER BY miktar ASC
        ''')
        low_stock = cursor.fetchall()
        analysis['low_stock'] = [{'barkod': row[0], 'ad': row[1], 'miktar': row[2]} for row in low_stock]
        
        conn.close()
        
        result = {
            'success': True,
            'message': 'Veri analizi tamamlandı',
            'analysis': analysis,
            'timestamp': datetime.now().isoformat()
        }
        
        print(json.dumps(result))
        
    except Exception as e:
        error_result = {
            'success': False,
            'error': str(e),
            'message': 'Veri analizi başarısız'
        }
        print(json.dumps(error_result))

if __name__ == '__main__':
    analyze_data()