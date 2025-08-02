#!/usr/bin/env python3
import sqlite3
import json
import os
import sys
from datetime import datetime, timedelta

def generate_report(report_type='monthly'):
    try:
        # Veritabanı yolu
        db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'veriler', 'veritabani.db')
        
        # Veritabanına bağlan
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        report = {
            'report_type': report_type,
            'generated_at': datetime.now().isoformat(),
            'data': {}
        }
        
        if report_type == 'monthly':
            # Aylık rapor
            current_month = datetime.now().strftime('%Y-%m')
            
            # Aylık satış verileri
            cursor.execute('''
                SELECT 
                    COUNT(*) as total_sales,
                    SUM(toplam) as total_revenue,
                    AVG(toplam) as avg_sale_amount
                FROM satisGecmisi 
                WHERE tarih LIKE ?
            ''', (f'{current_month}%',))
            
            sales_data = cursor.fetchone()
            report['data']['monthly_sales'] = {
                'total_sales': sales_data[0],
                'total_revenue': sales_data[1] or 0,
                'avg_sale_amount': sales_data[2] or 0
            }
            
            # En çok satılan ürünler
            cursor.execute('''
                SELECT s.barkod, st.ad, SUM(s.miktar) as total_sold, SUM(s.toplam) as total_revenue
                FROM satisGecmisi s
                JOIN stok st ON s.barkod = st.barkod
                WHERE s.tarih LIKE ?
                GROUP BY s.barkod
                ORDER BY total_sold DESC
                LIMIT 10
            ''', (f'{current_month}%',))
            
            top_products = cursor.fetchall()
            report['data']['top_products'] = [
                {
                    'barkod': row[0],
                    'ad': row[1],
                    'total_sold': row[2],
                    'total_revenue': row[3]
                } for row in top_products
            ]
            
        elif report_type == 'inventory':
            # Stok raporu
            cursor.execute('''
                SELECT 
                    COUNT(*) as total_items,
                    SUM(miktar) as total_quantity,
                    SUM(miktar * alisFiyati) as total_value
                FROM stok
            ''')
            
            inventory_data = cursor.fetchone()
            report['data']['inventory'] = {
                'total_items': inventory_data[0],
                'total_quantity': inventory_data[1] or 0,
                'total_value': inventory_data[2] or 0
            }
            
            # Düşük stoklu ürünler
            cursor.execute('''
                SELECT barkod, ad, miktar, alisFiyati
                FROM stok
                WHERE miktar <= 10
                ORDER BY miktar ASC
            ''')
            
            low_stock = cursor.fetchall()
            report['data']['low_stock'] = [
                {
                    'barkod': row[0],
                    'ad': row[1],
                    'miktar': row[2],
                    'alisFiyati': row[3]
                } for row in low_stock
            ]
            
        elif report_type == 'customers':
            # Müşteri raporu
            cursor.execute('SELECT COUNT(*) FROM musteriler')
            total_customers = cursor.fetchone()[0]
            
            cursor.execute('SELECT SUM(bakiye) FROM musteriler')
            total_balance = cursor.fetchone()[0] or 0
            
            report['data']['customers'] = {
                'total_customers': total_customers,
                'total_balance': total_balance
            }
            
            # En çok alışveriş yapan müşteriler
            cursor.execute('''
                SELECT s.musteriId, m.ad, COUNT(*) as purchase_count, SUM(s.toplam) as total_spent
                FROM satisGecmisi s
                JOIN musteriler m ON s.musteriId = m.id
                GROUP BY s.musteriId
                ORDER BY total_spent DESC
                LIMIT 10
            ''')
            
            top_customers = cursor.fetchall()
            report['data']['top_customers'] = [
                {
                    'musteriId': row[0],
                    'ad': row[1],
                    'purchase_count': row[2],
                    'total_spent': row[3]
                } for row in top_customers
            ]
        
        conn.close()
        
        result = {
            'success': True,
            'message': f'{report_type} raporu oluşturuldu',
            'report': report
        }
        
        print(json.dumps(result))
        
    except Exception as e:
        error_result = {
            'success': False,
            'error': str(e),
            'message': 'Rapor oluşturma başarısız'
        }
        print(json.dumps(error_result))

if __name__ == '__main__':
    report_type = sys.argv[1] if len(sys.argv) > 1 else 'monthly'
    generate_report(report_type)