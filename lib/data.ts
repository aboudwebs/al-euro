export const BRANDS=["Mercedes-Benz","BMW","Audi","Range Rover","Volkswagen"];

// Shape the customer app uses. It is built from the `parts` table by /api/parts
// (pn = oem_number, altGrade = alt_grade, image = image_url).
export type Part={
  id:string;
  name:string;
  brand:string;
  pn:string;
  price:number;
  stock:number;
  model?:string;
  years?:string;
  altGrade?:string|null;
  branch?:string;
  image?:string|null;
};

// Seed data only: it is NOT read by the app any more. supabase/admin_full_setup.sql inserts these rows into `parts`
// once (when the table is empty). Manage parts from the admin dashboard afterwards.
export const SEED_PARTS:Part[]=[
{id:"1",name:"فلتر زيت",brand:"Mercedes-Benz",pn:"A2761800009",price:18,stock:42},
{id:"2",name:"طقم فحمات أمامي",brand:"BMW",pn:"34116761244",price:75,stock:15},
{id:"3",name:"مضخة مياه",brand:"Audi",pn:"06H121026",price:95,stock:8},
{id:"4",name:"مساعد أمامي",brand:"Range Rover",pn:"LR032049",price:210,stock:5},
{id:"5",name:"بوجي إشعال",brand:"Volkswagen",pn:"06K905601",price:12,stock:60},
{id:"6",name:"حساس أوكسجين",brand:"BMW",pn:"11787589121",price:64,stock:0},
{id:"7",name:"فلتر هواء",brand:"Mercedes-Benz",pn:"A2760940004",price:22,stock:30},
{id:"8",name:"سير مجموعة",brand:"Audi",pn:"06E903137",price:38,stock:12}];
export const TIERS=[{n:"برونزية",min:0,cb:"2%"},{n:"فضية",min:1000,cb:"5–8%"},{n:"ذهبية",min:3000,cb:"10–12%"},{n:"بلاتينية",min:6000,cb:"15%"},{n:"النخبة VIP",min:10000,cb:"حتى 20%"}];
export const usd=(n:number)=>"$"+n.toLocaleString("en-US",{maximumFractionDigits:2});
