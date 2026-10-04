import { chromium } from 'playwright'
const b=await chromium.launch()
/* баг №23 целился в холодный старт по ссылке: фон обязан появиться */
{
  const p=await b.newPage({viewport:{width:1280,height:860}})
  await p.goto('http://127.0.0.1:4173/modals?modal=card&modal.0.id=7'); await p.waitForTimeout(1200)
  console.log('холодный старт по ссылке:', JSON.stringify(await p.evaluate(()=>{
    const bd=document.querySelector('.modal-backdrop')
    return {сцен:document.querySelectorAll('.modal-stage').length,
      фон: bd ? (bd.hasAttribute('hidden')?'есть, но hidden':'виден') : 'НЕТ УЗЛА',
      непрозрачность: bd?getComputedStyle(bd).opacity:null,
      размер: bd?Math.round(bd.getBoundingClientRect().width)+'x'+Math.round(bd.getBoundingClientRect().height):null}})))
  await p.close()
}
/* и обычное открытие кликом, два раза подряд */
{
  const p=await b.newPage({viewport:{width:1280,height:860}})
  await p.goto('http://127.0.0.1:4173/modals'); await p.waitForTimeout(700)
  for (let i=1;i<=2;i++){
    await p.locator('text=Открыть карточку').first().click(); await p.waitForTimeout(700)
    const st=await p.evaluate(()=>{const bd=document.querySelector('.modal-backdrop')
      return bd?(bd.hasAttribute('hidden')?'hidden':`виден opacity=${getComputedStyle(bd).opacity}`):'НЕТ УЗЛА'})
    console.log(`открытие ${i}: фон ${st}`)
    await p.keyboard.press('Escape'); await p.waitForTimeout(700)
  }
  await p.close()
}
await b.close()
