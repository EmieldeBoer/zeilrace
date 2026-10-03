// 📜 Regels: de zeilregels in het kort en de Piratencode van het piratenspel
import type { ReactNode } from "react";
import { BuitLijst } from "@/components/Spel";
import { Card, CardContent } from "@/components/ui/card";

const Em = ({ children }: { children: ReactNode }) => <span className="font-bold text-signaal">{children}</span>;
function Kaartje({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <Card className="mb-3.5 rounded-md py-4">
      <CardContent className="px-[18px]">
        <h3 className="mb-1.5 font-kop text-[1.05rem] font-bold tracking-[.03em]">{titel}</h3>
        <div className="text-[1.05rem] leading-[1.55]">{children}</div>
      </CardContent>
    </Card>
  );
}

export function Regels({ piraat }: { piraat: boolean }) {
  return (
    <div className="mx-auto max-w-[820px]">
      <h1 className="titel mb-1 text-[2.4rem]">{piraat ? "📜 De Code: zeilregels in het kort" : "Zeilregels in het kort"}</h1>
      <p className="mb-[22px] text-[1.08rem] leading-normal text-muted-foreground italic">De belangrijkste regels om samen veilig en eerlijk te racen.
        Dit is een vereenvoudigde uitleg, geen vervanging van de officiële <em>Racing Rules of Sailing</em>.</p>

      <Kaartje titel="🚦 De start">
        <p>Iemand uit de groep <Em>stelt een starttijd voor</Em>, en elke boot die meevaart geeft op zijn telefoon akkoord.
          Pas als iedereen akkoord is, ligt de start vast. Daarna verandert hij niet meer.
          De race begint met een <Em>startsein</Em> op die starttijd; op de schermen telt een
          grote klok ernaartoe af, met een kanonschot op 5 minuten, 1 minuut en bij de start. Je mag de startlijn pas ná
          jouw startsein in de juiste richting kruisen — ben je te vroeg over, dan moet je terug en opnieuw starten.
          <Em> De tijd loopt vanaf het startsein</Em>, dus hoe later je de lijn kruist, hoe meer tijd het je kost.</p>
      </Kaartje>

      <Kaartje titel="⚖️ Rating en twee soorten start">
        <p>De boten zijn niet even snel: een grotere of modernere boot is sneller. Daarom heeft elke boot een
          <Em> rating</Em> (de host stelt die in, bijvoorbeeld uit een ORC-certificaat). Er zijn drie manieren van starten:<br />
          • <b>Gelijke start</b> — iedereen start tegelijk; na afloop wordt je tijd met de rating omgerekend
          (gecorrigeerde tijd).<br />
          • <b>Achtervolgingsstart</b> — de langzaamste boot start eerst, de snellere boten starten later. Het
          verschil is precies de verwachte tijd die de snellere boot sneller is. In theorie finisht iedereen
          tegelijk: <Em>wie het eerst over de finish gaat, wint</Em>.<br />
          • <b>Lusstart</b> — iedereen start tegelijk, maar elke boot krijgt een eigen <Em>lus</Em>:
          twee extra boeien (A en B, in de kleur van je boot) naast een rak. Je vaart langs de lus naar boei A,
          keert terug naar boei B en vaart dan verder, een kleine α. Boei A ligt voor iedereen op dezelfde plek; hoe
          sneller je boot, hoe verder je boei B terug ligt en hoe langer je lus. Ook hier
          finisht in theorie iedereen tegelijk en <Em>wint wie het eerst binnen is</Em>. Je ziet alleen je
          eigen lus op je tracker.<br />
          Bij een gelijke start telt de uitslag <b>met</b> rating (gecorrigeerde tijd); de verzeilde tijd staat er ter informatie bij.<br />
          Is er al een boot binnen, dan zie je bij de andere boten <Em>hoeveel tijd ze nog hebben om te winnen</Em>,
          met de rating meegerekend.</p>
      </Kaartje>

      <Kaartje titel="⬅️ Bakboord heeft voorrang">
        <p>We kijken naar het <Em>zeil</Em>: staan jouw giek en grootzeil <Em>over bakboord</Em> (links), dan heb jij voorrang.
          Staat je giek over stuurboord (rechts), dan moet jij uitwijken voor de bakboordboot. Bij twijfel: tijdig en duidelijk uitwijken.</p>
      </Kaartje>

      <Kaartje titel="⬆️ Loef wijkt voor lij">
        <p>Liggen twee boten aan dezelfde kant (zelfde overstag)? Dan moet de <Em>loefboot</Em> (bovenwinds) uitwijken voor de
          <Em> lijboot</Em> (benedenwinds). Oploeven mag, maar geef de ander ruimte om vrij te blijven.</p>
      </Kaartje>

      <Kaartje titel="🟠 Boeien ronden">
        <p>Rond de boeien in de <Em>juiste volgorde</Em>. Bij elke boei hoort een <Em>rondingslijn</Em> (de stippellijn in de kleur
          van de boei op je tracker) die vanaf de boei naar buiten loopt, in de richting van de bocht die de baan daar maakt. Je hebt
          de boei gerond zodra je die lijn <Em>oversteekt</Em> — of dat aan bakboord of stuurboord is, volgt vanzelf uit de baan.
          Ligt een boei vrijwel op een rechte lijn (geen bocht), dan loopt de lijn <Em>dwars</Em> door de boei: passeren aan welke
          kant dan ook telt. Mist je telefoon een ronding, dan kan een host hem handmatig goedkeuren. Kom je met twee
          boten tegelijk bij een boei, dan heeft de binnenboot (die overlap heeft) recht op ruimte om te ronden.</p>
      </Kaartje>

      <Kaartje titel="🔄 Wie manoeuvreert, wijkt">
        <p>Een boot die <Em>overstag gaat of gijpt</Em> moet vrij blijven van boten die hun koers varen. Rond je manoeuvre af
          vóórdat je een ander in gevaar brengt.</p>
      </Kaartje>

      <Kaartje titel="🏁 De finish">
        <p>Je bent gefinisht zodra je de finishlijn kruist — maar pas nádat je álle boeien hebt gerond. Je verzeilde tijd is de
          tijd <Em>van jouw startsein tot je finish</Em>.</p>
      </Kaartje>

      {piraat && <>
      <h1 className="titel mt-9 mb-1 text-[2rem]">🏴‍☠️ De Piratencode: het piratenspel</h1>
      <p className="mb-[22px] text-[1.08rem] leading-normal text-muted-foreground italic">Een zeeslag tussen de races door. Geen echte kanonnen:
        alles gebeurt op de tracker en de kaart. De zeilregels hierboven blijven gewoon gelden: een treffer is nooit een reden om
        dicht bij een ander te komen.</p>

      <Kaartje titel="⚓ Het begin">
        <p>Een host tekent het <Em>speelveld</Em>: een rode cirkel op de kaart, standaard met een straal van 919 meter.
          Na <Em>Start zeeslag</Em> telt een grote klok 5 minuten af, met een kanonschot op 5 minuten, 1 minuut en bij de start —
          net als bij de race. Daarna heeft elk schip <Em>3 levens</Em> en <Em>10 salvo's</Em>. Je doet mee als je tracker aanstaat.</p>
      </Kaartje>

      <Kaartje titel="💥 Schieten">
        <p>Met <Em>💥 Vuur het kanon!</Em> vuur je een breedzijde af: 10 kogels per kant, haaks op je koers, naar bakboord én
          stuurboord, tot 150 meter ver. De stippellijnen op de kaart laten zien waar je salvo valt. Komt een kogel binnen
          <Em> 20 meter</Em> van een ander schip, dan is het raak en verliest dat schip een leven. Na elk salvo moet je kanon
          <Em> een minuut herladen</Em>. Ben je geraakt, dan ligt je kanon een minuut stil. Draai dus je zijkant naar de tegenstander.</p>
      </Kaartje>

      <Kaartje titel="⭕ Het speelveld">
        <p>Blijf binnen de rode cirkel: <Em>elke 20 seconden daarbuiten kost een leven</Em> (je tracker waarschuwt en telt af).
          Na <Em>10 minuten krimpt de cirkel</Em>: in 20 minuten wordt hij geleidelijk een kwart zo groot (minstens 150 meter straal).
          Bij het begin van het krimpen klinkt drie keer de scheepsbel.</p>
      </Kaartje>

      <Kaartje titel="📦 Schatkisten">
        <p>Richting het midden van het speelveld drijven <Em>3 schatkisten</Em>, minstens 155 meter (ongeveer een minuut varen)
          uit elkaar. Vaar binnen de gele cirkel om een kist (50 meter) en je krijgt wat erin zit; wat dat is, zie je pas als je hem
          hebt. Elke kist verhuist na 4 minuten naar een nieuwe plek. Lading bewaar je tot je hem gebruikt (je ziet dan 💰 achter je
          levens), en zolang je lading hebt, pak je geen nieuwe kist. Er kan in zitten:</p>
        <BuitLijst />
      </Kaartje>

      <Kaartje titel="💣 Zeemijnen">
        <p>Heb je een zeemijn uit een kist, dan leg je hem met <Em>Leg een zeemijn</Em> op je plek. Alleen jij en de
          hosts zien hem liggen. Vaart een ander schip er later binnen 25 meter langs, dan ontploft hij en verliest dat
          schip een leven (een schild vangt de klap op). Over je eigen mijn vaar je veilig.</p>
      </Kaartje>

      <Kaartje titel="🏆 Einde en winnaar">
        <p>De zeeslag is voorbij als er nog maar <Em>één schip drijft</Em>, als iedereen zijn kruit heeft verschoten, of als een
          host hem stopt. Winnaar: de meeste levens, dan de meeste treffers, dan de meeste salvo's over. Elke zeeslag
          wordt bewaard bij <Em>Uitslagen</Em>, met een replay en een scheepsjournaal.</p>
      </Kaartje>
      </>}

      <p className="mt-[18px] text-[.95rem] leading-normal text-muted-foreground italic">Veiligheid gaat altijd vóór de regels: voorkom
        aanvaringen, ook als je voorrang hebt. Twijfel je? Wijk uit en bespreek het na afloop.</p>
    </div>
  );
}
