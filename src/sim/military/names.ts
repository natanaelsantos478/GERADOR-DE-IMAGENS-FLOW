/** Generic given-name / surname pools by language region (common names only; combinations are fictional). */
import type { Country } from '../../core/contracts';

type Pool = { f: string[]; l: string[]; surnameFirst?: boolean };
const P = (f: string, l: string, surnameFirst = false): Pool => ({ f: f.split(' '), l: l.split(' '), surnameFirst });

const POOLS: Record<string, Pool> = {
  pt: P('João Carlos Pedro Antônio Paulo Ricardo Marcos Eduardo Rafael Fernando Luís Sérgio', 'Silva Santos Oliveira Souza Pereira Costa Rodrigues Almeida Nascimento Lima Araújo Ferreira Barbosa Carvalho'),
  es: P('José Carlos Luis Miguel Javier Manuel Francisco Antonio Alejandro Ramón Andrés Jorge', 'García Rodríguez Martínez López González Pérez Sánchez Ramírez Torres Flores Vargas Herrera Romero Castillo'),
  en: P('James John Robert Michael William David Richard Thomas Charles Andrew Peter Edward', 'Smith Johnson Williams Brown Taylor Davies Wilson Anderson Clark Walker Hughes Mitchell Campbell Turner'),
  fr: P('Jean Pierre Michel Philippe Louis Henri François Alain Bernard Olivier Thierry Marc', 'Martin Bernard Dubois Moreau Laurent Lefebvre Girard Fontaine Mercier Dupont Roussel Lambert Garnier'),
  de: P('Hans Karl Friedrich Wolfgang Klaus Jürgen Stefan Michael Thomas Andreas Werner Gerhard', 'Müller Schmidt Schneider Fischer Weber Wagner Becker Hoffmann Schulz Koch Richter Bauer Krüger'),
  it: P('Giuseppe Giovanni Marco Antonio Luca Paolo Francesco Stefano Roberto Alberto Franco Vittorio', 'Rossi Russo Ferrari Esposito Bianchi Romano Colombo Ricci Marino Greco Bruno Conti Moretti'),
  ru: P('Aleksandr Sergei Dmitri Nikolai Vladimir Andrei Mikhail Viktor Igor Pavel Yuri Oleg', 'Ivanov Petrov Smirnov Kuznetsov Popov Sokolov Lebedev Volkov Morozov Novikov Fedorov Kovalenko Bondarenko'),
  pl: P('Jan Piotr Andrzej Tomasz Marek Krzysztof Pavel Jakub Karel Zoltán László Milan', 'Nowak Kowalski Wiśniewski Dvořák Novák Horváth Kovács Szabó Svoboda Kaminski Zielinski Nagy'),
  nord: P('Lars Erik Anders Johan Nils Henrik Bjørn Olav Mikael Jukka Matti Soren', 'Johansson Andersen Nielsen Hansen Larsen Lindqvist Virtanen Korhonen Berg Karlsson Jensen Eriksson'),
  tr: P('Mehmet Mustafa Ahmet Ali Hasan Hüseyin İbrahim Murat Kemal Orhan Emre Selim', 'Yılmaz Kaya Demir Çelik Şahin Yıldız Öztürk Aydın Arslan Doğan Kılıç Aslan Polat'),
  ar: P('Mohamed Ahmed Khaled Omar Youssef Hassan Ibrahim Tarek Karim Nasser Faisal Sami', 'Al-Masri Al-Hashimi Haddad Mansour Khalil Nasser Saleh Al-Rashid Farouk Darwish Sabri Al-Tamimi Bakr'),
  fa: P('Ali Reza Hossein Mehdi Hamid Abbas Majid Farhad Davood Kamran Saeed Babak', 'Hosseini Ahmadi Karimi Rahimi Mousavi Jafari Rezaei Sadeghi Navid Tehrani Ghorbani Azizi Safavi'),
  hi: P('Rajesh Amit Vikram Sanjay Anil Rahul Suresh Arjun Imran Tariq Nasir Kamal', 'Sharma Singh Kumar Patel Gupta Reddy Khan Malhotra Chaudhry Rahman Hussain Nair Das'),
  zh: P('Wei Jun Ming Hao Lei Jian Tao Qiang Yong Feng Bo Gang', 'Wang Li Zhang Liu Chen Yang Zhao Huang Zhou Wu Xu Sun Ma', true),
  ja: P('Hiroshi Takeshi Kenji Masaru Akira Satoshi Yuji Daisuke Shigeru Taro Kazuo Naoki', 'Sato Suzuki Takahashi Tanaka Watanabe Ito Yamamoto Nakamura Kobayashi Kato Yoshida', true),
  ko: P('Min-jun Joon-ho Sung-min Jae-won Hyun-woo Dong-hyun Seung-ho Young-soo Tae-yang Ji-hoon', 'Kim Lee Park Choi Jung Kang Cho Yoon Jang Lim', true),
  sea: P('Nguyen Somchai Budi Ahmad Rizal Arief Joko Tran Anwar Surya Prasert Dato', 'Nguyen Tran Le Pham Wijaya Santoso Suharto Chaiyasit Ramos Cruz Reyes Tan Lim'),
  af: P('Kwame Kofi Samuel Joseph Emmanuel Peter Daniel Tendai Chidi Amadou Moussa Thabo', 'Mensah Okafor Mwangi Diallo Traoré Ndlovu Banda Kamau Nkosi Abebe Mutasa Osei Kone'),
};

const LUSO = new Set(['BRA', 'PRT', 'AGO', 'MOZ', 'GNB', 'CPV', 'STP', 'TLS']);
const ANGLO = new Set(['USA', 'GBR', 'CAN', 'AUS', 'NZL', 'IRL', 'JAM', 'BHS', 'BRB', 'TTO', 'GUY', 'BLZ']);
const FRANCO = new Set(['FRA', 'BEL', 'LUX', 'MCO', 'SEN', 'CIV', 'MLI', 'BFA', 'NER', 'TGO', 'BEN', 'GIN', 'COD', 'COG', 'GAB', 'CMR', 'TCD', 'CAF', 'HTI', 'DJI', 'MDG']);

export function poolKeyOf(c: Country): string {
  const id = c.id, sub = c.subregion;
  if (LUSO.has(id)) return 'pt';
  if (ANGLO.has(id) || sub === 'Northern America' || sub === 'Australia and New Zealand' || sub === 'Melanesia' || sub === 'Polynesia' || sub === 'Micronesia') return 'en';
  if (FRANCO.has(id)) return 'fr';
  if (['DEU', 'AUT', 'CHE', 'LIE'].includes(id)) return 'de';
  if (['ITA', 'SMR', 'VAT', 'MLT', 'GRC', 'ALB', 'CYP'].includes(id)) return 'it';
  if (id === 'ESP' || sub === 'South America' || sub === 'Central America' || sub === 'Caribbean') return 'es';
  if (['POL', 'CZE', 'SVK', 'HUN'].includes(id)) return 'pl';
  if (sub === 'Eastern Europe' || sub === 'Central Asia' || ['SRB', 'HRV', 'BIH', 'MNE', 'MKD', 'SVN', 'ARM', 'GEO'].includes(id) || sub === 'Southern Europe') return 'ru';
  if (sub === 'Northern Europe') return 'nord';
  if (id === 'TUR' || id === 'AZE') return 'tr';
  if (id === 'IRN' || id === 'AFG') return 'fa';
  if (sub === 'Southern Asia') return 'hi';
  if (id === 'CHN' || id === 'TWN' || id === 'MNG') return 'zh';
  if (id === 'JPN') return 'ja';
  if (id === 'KOR' || id === 'PRK') return 'ko';
  if (sub === 'South-Eastern Asia') return 'sea';
  if (sub === 'Northern Africa' || sub === 'Western Asia') return 'ar';
  if (sub.endsWith('Africa')) return 'af';
  return 'en';
}

export function makeName(pool: string, a: number, b: number): string {
  const p = POOLS[pool] ?? POOLS.en;
  const f = p.f[a % p.f.length], l = p.l[b % p.l.length];
  return p.surnameFirst ? `${l} ${f}` : `${f} ${l}`;
}
