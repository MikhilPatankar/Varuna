import os

frontend_dir = r'e:\PROJECT\POLARIS\frontend'
for root, _, files in os.walk(frontend_dir):
    if 'node_modules' in root:
        continue
    for file in files:
        if not file.endswith(('.jsx', '.js', '.html', '.css')):
            continue
        filepath = os.path.join(root, file)
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # 1. Logo
        content = content.replace('<span className="logo-text">POLARIS</span>', '<span className="logo-text">VARUN</span>')
        # 2. HTML Title
        content = content.replace('<title>POLARIS - Ocean Digital Twin</title>', '<title>VARUN - Ocean Digital Twin</title>')
        # 3. Global DOM
        content = content.replace('window.polaris', 'window.varun')
        # 4. Custom Events and localStorage (e.g., polaris-tool-changed -> varun-tool-changed, polaris_ -> varun_)
        content = content.replace("'polaris-", "'varun-")
        content = content.replace("'polaris_", "'varun_")
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)

print('Done replacement')
