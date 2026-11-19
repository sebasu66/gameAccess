// Interacciones locales del banco; no hay persistencia ni conexión a la app.
document.querySelectorAll('.section-nav').forEach(nav=>nav.addEventListener('click',e=>{const button=e.target.closest('.nav-option');if(!button)return;nav.querySelectorAll('.nav-option').forEach(item=>item.removeAttribute('aria-current'));button.setAttribute('aria-current','page')}));
document.querySelectorAll('.switch input').forEach(input=>input.addEventListener('change',()=>{input.closest('.toggle-row').querySelector('output').textContent=input.checked?'Activado':'Desactivado'}));
document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>{document.querySelector('.status').textContent=button.dataset.action+': acción de prueba, sin guardar cambios.'}));
