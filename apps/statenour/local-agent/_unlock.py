import os  
f=r'C:\Users\nourd\NOUR-OS\apps\statenour-os\local-agent\agent.log'  
try:  
    os.remove(f)  
    print('Deleted')  
except Exception as e:  
    print(f'Failed: {e}') 
