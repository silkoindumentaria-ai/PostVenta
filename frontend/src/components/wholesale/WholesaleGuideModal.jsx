// Guía de uso de la vista de mayoristas. Es de solo lectura: no toca datos ni
// llama a la API, así que no tiene estado más allá de cerrarse.
//
// El contenido está ordenado como se usa el panel, no como está construido:
// primero lo que se hace una sola vez, después la rutina de todos los días, y al
// final la referencia. Los pasos van numerados porque son una secuencia real —
// el orden importa; la referencia va en tablas justamente porque no lo es.
import { useEffect, useRef } from 'react'
import {
  AlertTriangle, Clock, CircleCheck, CircleSlash, Settings, DownloadCloud, RefreshCw,
} from 'lucide-react'

const SETUP = [
  {
    title: <>Abrí <Kbd>Configuración</Kbd> y cargá tu equipo</>,
    body: (
      <>
        <p>
          Escribí los <strong>vendedores</strong>. Sin esa lista, el campo Vendedor al registrar
          un contacto es texto libre y cada uno lo escribe distinto: después no vas a poder
          filtrar por vendedor.
        </p>
        <p>
          Revisá también los <strong>umbrales del semáforo</strong> y el tipo de cliente de
          Gestion Moda que se importa como mayorista.
        </p>
        <p className="wh-guide-note wh-guide-note-warn">
          <AlertTriangle size={15} />
          <span>
            <strong>Ojo con los umbrales.</strong> Si están en 15 y 30 días, la mayoría de tus
            mayoristas va a caer en "Inactivos". Un cliente que compra cada 45 días no está
            perdido: es el umbral que está corto. Subilos hasta que "Inactivos" señale gente que
            de verdad se enfrió.
          </span>
        </p>
      </>
    ),
  },
  {
    title: <>Apretá <Kbd primary>Importar de GM</Kbd></>,
    body: (
      <>
        <p>
          Trae todos los clientes que en Gestion Moda tienen el Tipo de Cliente
          <strong> Mayorista</strong>. Tarda segundos y te dice qué hizo: cuántos nuevos, cuántos
          actualizados, cuántos archivados.
        </p>
        <p>
          No hace falta apretarlo todos los días: el panel se reimporta solo una vez por día al
          abrirlo. Usalo cuando acabás de etiquetar un mayorista en Gestion Moda y lo querés ver
          en el momento.
        </p>
      </>
    ),
  },
  {
    title: <>Dejá correr <Kbd>Sincronizar ventas</Kbd></>,
    body: (
      <>
        <p>
          Arranca solo después del import y trae las compras de los últimos meses de cada
          mayorista. <strong>Tarda unos minutos</strong>: Gestion Moda limita cuántas consultas
          se pueden hacer por minuto, así que el panel las hace de a una y te muestra el avance
          ("cliente 37 de 90").
        </p>
        <p>
          Podés seguir usando el panel mientras corre, pero hasta que termine las tarjetas no
          tienen unidades ni facturado — y el semáforo todavía no significa nada.
        </p>
      </>
    ),
  },
]

const ROUTINE = [
  {
    title: <>Entrá a <Kbd>Mayoristas</Kbd> y mirá el número rojo</>,
    body: (
      <p>
        El badge del botón cuenta los contactos <strong>vencidos más los de hoy</strong>: es tu
        carga del día. Si está en cero, no hay nada comprometido y podés ir directo al paso 3.
      </p>
    ),
  },
  {
    title: <>La agenda, arriba de todo</>,
    body: (
      <>
        <p>
          Tres grupos en orden: <strong>Vencidos</strong>, <strong>Para contactar hoy</strong> y
          <strong> Esta semana</strong>. Cada renglón muestra los días de atraso y la nota de la
          última vez.
        </p>
        <p>
          Es trabajo ya comprometido: alguien dijo "lo vuelvo a llamar tal día". Va antes que
          cualquier otra cosa.
        </p>
      </>
    ),
  },
  {
    title: <>La sección <Kbd>En riesgo</Kbd></>,
    body: (
      <p>
        Los que hace poco que no compran, pero todavía no se enfriaron.{' '}
        <strong>Es el grupo con más retorno</strong>: te tienen presente y una sola conversación
        suele alcanzar. Dentro de la sección están ordenados por facturación, así que el primero
        es el que más deja.
      </p>
    ),
  },
  {
    title: <>La cabeza de <Kbd>Inactivos</Kbd></>,
    body: (
      <>
        <p>
          Es el grupo más grande y no vas a llamarlos a todos — no hace falta. Están ordenados
          por <strong>facturado</strong>, así que los primeros son los que más compraron antes de
          desaparecer. Trabajá los primeros diez o quince y dejá el resto.
        </p>
        <p className="wh-guide-note wh-guide-note-key">
          <span>
            <strong>Por qué en este orden.</strong> Un mayorista que dejó $859.000 y hace 38 días
            que no compra vale muchísimo más que uno que nunca compró. El orden por facturado
            pone esa diferencia adelante, en vez de esconderla en la letra "L".
          </span>
        </p>
      </>
    ),
  },
  {
    title: <>Por cada cliente: <Kbd>WhatsApp</Kbd>, hablar, <Kbd primary>Registrar contacto</Kbd></>,
    body: (
      <>
        <p>
          El botón verde abre el chat <strong>en blanco</strong>, sin mensaje armado: acá cada
          conversación es distinta. Si el cliente no tiene teléfono cargado en Gestion Moda vas a
          ver "Sin teléfono" — hay que cargarlo allá.
        </p>
        <p>
          Terminada la charla, volvé y registrá lo que pasó. <strong>Este es el paso que no se
          saltea.</strong>
        </p>
      </>
    ),
  },
]

const FIELDS = [
  ['Fecha', 'Viene con la de hoy. Cambiala si estás cargando una charla de ayer.'],
  ['Resultado', 'Compró · Va a comprar · Pidió info / precios · No contesta · No le interesa por ahora.'],
  ['¿Qué dijo?', 'Escribila pensando en vos dentro de tres semanas: "pide lista actualizada, hace pedido cuando cobre el 10" sirve; "hablamos" no.'],
  ['Vendedor', 'Quién habló. Si cargaste el equipo en Configuración, lo elegís de la lista.'],
  ['Próximo contacto', 'Atajos +7d / +15d / +30d, o una fecha a mano.'],
]

const SECTION_REF = [
  { Icon: AlertTriangle, tone: 'warn', label: 'En riesgo', who: 'Pocos días sin comprar, todavía se recuperan', what: 'Llamar. Es donde más se recupera.' },
  { Icon: Clock, tone: 'alert', label: 'Inactivo', who: 'Pasaron el umbral rojo sin comprar', what: 'Trabajar los primeros de la lista, no todos.' },
  { Icon: CircleCheck, tone: 'ok', label: 'Al día', who: 'Compraron hace poco', what: 'Nada. Viene plegada a propósito.' },
  { Icon: CircleSlash, tone: 'none', label: 'Sin compras', who: 'Están en Gestion Moda pero nunca compraron', what: 'Prospección, cuando sobre tiempo. Plegada.' },
]

const CONTROL_REF = [
  ['Ordenar por', 'Cambia el orden dentro de cada sección: Facturado (por defecto), Unidades, Última compra o Nombre.'],
  ['Píldoras de filtro', 'Al activar una, la grilla deja de mostrarse por secciones y pasa a ser una lista plana: la píldora ya es el recorte.'],
  ['⟳ en la tarjeta', 'Actualiza ese cliente contra Gestion Moda (teléfono, email y ventas) en un par de segundos. Útil cuando sabés que acaba de comprar.'],
  ['⋮ en la tarjeta', 'Ver y editar la ficha, archivar o eliminar.'],
  ['Archivar', 'Lo saca del listado y conserva todo su historial. Reversible desde la píldora "Archivados". Es lo que querés casi siempre.'],
  ['Eliminar', 'Borra el cliente, sus contactos y sus compras cacheadas. Sin vuelta atrás: solo para algo cargado por error.'],
  ['"Ya no es Mayorista en GM"', 'En Gestion Moda le cambiaron el tipo o lo dieron de baja. Se queda con su historial para que decidas: si ya no lo seguís, archivalo.'],
]

// Nombre literal de un control del panel, para distinguir "apretá esto exactamente"
// de la prosa que lo rodea.
function Kbd({ children, primary = false }) {
  return <span className={`wh-kbd ${primary ? 'wh-kbd-primary' : ''}`}>{children}</span>
}

function Steps({ items }) {
  return (
    <ol className="wh-guide-steps">
      {items.map((s, i) => (
        <li key={i}>
          <div className="wh-guide-step-body">
            <h4>{s.title}</h4>
            {s.body}
          </div>
        </li>
      ))}
    </ol>
  )
}

export default function WholesaleGuideModal({ onClose }) {
  const closeRef = useRef(null)

  // El foco arranca en el botón de cerrar: como los modales de esta vista se
  // cierran solo con la X (ni el overlay ni Escape los cierran), conviene que la
  // salida sea lo primero que encuentra alguien que navega con teclado.
  useEffect(() => { closeRef.current?.focus() }, [])

  return (
    // El overlay no cierra: la regla del módulo es que un modal se cierra a
    // propósito, con su botón.
    <div className="modal-overlay">
      <div className="modal wh-guide-modal" role="dialog" aria-modal="true" aria-labelledby="wh-guide-title">
        <div className="modal-header">
          <div className="modal-title-area">
            <h2 id="wh-guide-title">Cómo usar esta vista</h2>
          </div>
          <button ref={closeRef} className="modal-close-btn" onClick={onClose} aria-label="Cerrar">×</button>
        </div>

        <div className="wh-guide-body">
          <p className="wh-guide-lead">
            Esta vista no es un directorio de clientes: es una cola de trabajo. Bajás por la
            pantalla y, cuando se te acabó el tiempo, cortás — lo que quedó abajo es lo menos
            urgente.
          </p>

          <section className="wh-guide-phase">
            <h3>
              <Settings size={16} />
              Puesta a punto
              <span className="wh-guide-cadence">Una sola vez</span>
            </h3>
            <p className="wh-guide-intro">
              Tres pasos, en este orden. Configurar antes de importar evita rehacer trabajo: los
              umbrales deciden en qué sección cae cada cliente, y los vendedores tienen que
              existir para poder asignarlos.
            </p>
            <Steps items={SETUP} />
          </section>

          <section className="wh-guide-phase">
            <h3>
              <RefreshCw size={16} />
              La rutina diaria
              <span className="wh-guide-cadence">Todos los días</span>
            </h3>
            <p className="wh-guide-intro">
              El orden de estos cinco pasos es el orden de prioridad.
            </p>
            <Steps items={ROUTINE} />
          </section>

          <section className="wh-guide-phase">
            <h3>
              <DownloadCloud size={16} />
              El campo que hace funcionar todo
              <span className="wh-guide-cadence">Cada contacto</span>
            </h3>
            <p className="wh-guide-intro">
              <Kbd primary>Registrar contacto</Kbd> abre cinco campos. Cuatro guardan lo que pasó;
              el último decide si el cliente vuelve a aparecer.
            </p>

            <div className="wh-guide-engine">
              <dl className="wh-guide-fields">
                {FIELDS.map(([name, desc]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>{desc}</dd>
                  </div>
                ))}
              </dl>

              <p className="wh-guide-note wh-guide-note-key">
                <span>
                  <strong>Esto es el motor.</strong> La fecha de próximo contacto es lo que pone
                  al cliente en la agenda de ese día. Si la dejás sin fecha, el cliente{' '}
                  <strong>no vuelve a aparecer solo</strong>: depende de que te acuerdes. Poné
                  siempre una, aunque sea lejana — un "no le interesa por ahora" con +30d es un
                  seguimiento; sin fecha es un cliente perdido.
                </span>
              </p>
            </div>
          </section>

          <section className="wh-guide-phase">
            <h3>Qué significa cada sección</h3>
            <div className="wh-guide-table-wrap">
              <table className="wh-guide-table">
                <thead>
                  <tr><th>Sección</th><th>Quiénes caen ahí</th><th>Qué hacer</th></tr>
                </thead>
                <tbody>
                  {SECTION_REF.map(s => (
                    <tr key={s.label}>
                      <td>
                        <span className={`wh-chip wh-chip-${s.tone} wh-guide-chip`}>
                          <s.Icon size={12} /> {s.label}
                        </span>
                      </td>
                      <td>{s.who}</td>
                      <td>{s.what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="wh-guide-phase">
            <h3>Los controles</h3>
            <div className="wh-guide-table-wrap">
              <table className="wh-guide-table">
                <thead>
                  <tr><th>Control</th><th>Qué hace</th></tr>
                </thead>
                <tbody>
                  {CONTROL_REF.map(([name, desc]) => (
                    <tr key={name}>
                      <td className="wh-guide-control">{name}</td>
                      <td>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="wh-guide-closer">
            El ciclo se sostiene solo mientras cada conversación termine con una fecha de próximo
            contacto. Si la agenda te aparece vacía muchos días seguidos, no es que no haya
            trabajo: es que se están registrando contactos sin fecha.
          </p>

          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>Entendido</button>
          </div>
        </div>
      </div>
    </div>
  )
}
