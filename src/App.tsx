/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from "@google/genai";
import { 
  AnimatePresence, 
  motion 
} from "motion/react";
import { 
  ArrowRight,
  Camera, 
  Check,
  ChevronLeft, 
  ChevronRight, 
  CreditCard,
  Info, 
  Layers, 
  Maximize2, 
  Pyramid,
  Split,
  PersonStanding, 
  RotateCcw, 
  Scissors, 
  Shirt, 
  Sparkles,
  Trash2,
  Upload, 
  User,
  X 
} from "lucide-react";
import { 
  useCallback, 
  useEffect, 
  useState,
  type ReactNode,
  type ChangeEvent
} from "react";

// --- Types & Constants ---

enum Category {
  TOP = "top",
  BOTTOM = "bottom",
}

interface Measurements {
  bust?: number;
  upperWaist?: number; // for top
  midWaist?: number;   // for bottom
  hip?: number;
  height: number; // in cm
}

interface GarmentMeasurements {
  bust?: number;
  waist: number;
  hip?: number;
}

const STEPS = [
  "Selection",
  "Body Photo",
  "Garment Photo",
  "Body Stats",
  "Garment Stats",
  "Mirror"
];

// --- Initialization ---

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- Utils ---

/**
 * Resizes a base64 image to a target maximum dimension to speed up processing.
 */
async function resizeImage(base64: string, maxDim = 800): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxDim) {
          height *= maxDim / width;
          width = maxDim;
        }
      } else {
        if (height > maxDim) {
          width *= maxDim / height;
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.src = base64;
  });
}

// --- Components ---

export default function App() {
  const [step, setStep] = useState(0);
  const [hasPaid, setHasPaid] = useState(false);
  const [category, setCategory] = useState<Category | null>(null);
  const [bodyImage, setBodyImage] = useState<string | null>(null);
  const [garmentImage, setGarmentImage] = useState<string | null>(null);
  const [bodyStats, setBodyStats] = useState<Measurements>({ height: 165 }); // Default 165cm
  const [garmentStats, setGarmentStats] = useState<GarmentMeasurements>({ waist: 28 });
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [submissions, setSubmissions] = useState<any[]>([]);

  const fetchSubmissions = async () => {
    try {
      const res = await fetch('/api/admin/submissions');
      const data = await res.json();
      setSubmissions(data);
    } catch (err) {
      console.error("Failed to fetch submissions:", err);
    }
  };

  useEffect(() => {
    if (showAdmin) fetchSubmissions();
  }, [showAdmin]);

  const nextStep = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const prevStep = () => setStep((s) => Math.max(s - 1, 0));

  const handleGenerate = async () => {
    if (!bodyImage || !garmentImage || !category) return;

    setIsGenerating(true);
    setError(null);
    setStep(5); // Move to final step

    try {
      // Resize images before sending to API to significantly improve speed
      const [resizedBody, resizedGarment] = await Promise.all([
        resizeImage(bodyImage, 768),
        resizeImage(garmentImage, 768)
      ]);

      const bodyPart = {
        inlineData: {
          data: resizedBody.split(',')[1],
          mimeType: "image/jpeg",
        },
      };
      const garmentPart = {
        inlineData: {
          data: resizedGarment.split(',')[1],
          mimeType: "image/jpeg",
        },
      };

      const prompt = `
        You are a highly advanced AI Virtual Try-On system.
        Task: Synthesize the provided 'garment' image onto the 'body' image.
        
        Category: ${category.toUpperCase()}
        
        Body Measurements:
        - Height: ${bodyStats.height} cm
        ${category === Category.TOP ? `- Bust: ${bodyStats.bust}"\n- Upper Waist: ${bodyStats.upperWaist}"` : ""}
        ${category === Category.BOTTOM ? `- Mid Waist: ${bodyStats.midWaist}"\n- Hip: ${bodyStats.hip}"` : ""}
        
        Garment Measurements (Inches):
        - Waist: ${garmentStats.waist}"
        ${category === Category.TOP ? `- Bust: ${garmentStats.bust}"` : ""}
        ${category === Category.BOTTOM ? `- Hip: ${garmentStats.hip}"` : ""}

        Instructions:
        1. STRICTLY PRESERVE the original pose, stance, and body structure of the woman in the 'body' image. 
        2. Do NOT change the person's face, hair, arms, legs, or background.
        3. Rescale and warp the garment to fit the person's silhouette precisely based on measurements.
        4. Maintain the texture, pattern, and color of the garment.
        5. Ensure the lighting on the garment matches the 'body' image's environment.
        6. Render a photorealistic outcome where the woman is naturally wearing the garment.
        7. The final output MUST be an image.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [bodyPart, garmentPart, { text: prompt }],
        },
      });

      let found = false;
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          setResultImage(`data:image/png;base64,${part.inlineData.data}`);
          found = true;
          break;
        }
      }

      if (found) {
        const resultBase64 = `data:image/png;base64,${response.candidates[0].content.parts.find(p => p.inlineData)?.inlineData.data}`;
        setResultImage(resultBase64);

        // Send data and images to backend for collection
        try {
          await fetch('/api/submit-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              category,
              bodyStats,
              garmentStats,
              bodyImage,    // Uploaded body image
              garmentImage, // Uploaded garment image
              resultImage: resultBase64, // Generated result image
              timestamp: new Date().toISOString()
            })
          });
        } catch (submitErr) {
          console.error("Failed to submit data to backend:", submitErr);
        }
      } else {
        throw new Error("AI did not return an image. It might have refused or just sent text.");
      }
    } catch (err) {
      console.error(err);
      setError("Failed to generate the try-on. Please ensure both images are clear and comply with safety guidelines.");
    } finally {
      setIsGenerating(false);
    }
  };

  const reset = () => {
    setStep(0);
    setCategory(null);
    setBodyImage(null);
    setGarmentImage(null);
    setResultImage(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-[#1A1A1A] font-sans">
      {/* Background aesthetic touches */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden h-full w-full">
         <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-[#E8E1DA]/30 rounded-full blur-[100px]" />
         <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#D7DDE8]/20 rounded-full blur-[100px]" />
      </div>

      <header className="relative z-10 p-6 flex justify-between items-center border-b border-[#1A1A1A]/5">
        <div className="flex items-center gap-2" id="logo">
          <Sparkles className="w-6 h-6 text-[#1A1A1A]" />
          <h1 className="text-xl font-medium tracking-tight">Tryon-Mirror</h1>
        </div>
        <div className="flex gap-4">
          {STEPS.map((s, i) => (
            <div 
              key={s} 
              className={`text-[10px] uppercase tracking-widest transition-opacity duration-500 hidden sm:block ${i === step ? 'opacity-100 font-bold' : 'opacity-20'}`}
            >
              {s}
            </div>
          ))}
        </div>
        <button onClick={reset} className="p-2 hover:bg-black/5 rounded-full transition-colors">
          <RotateCcw className="w-5 h-5 opacity-40 hover:opacity-100 transition-opacity" />
        </button>
      </header>

      {!hasPaid ? (
        <main className="relative z-10 flex-1 flex items-center justify-center p-4 sm:p-8">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-white border border-black/5 rounded-[40px] p-10 shadow-2xl space-y-8 text-center"
          >
            <div className="w-20 h-20 bg-black rounded-3xl flex items-center justify-center mx-auto mb-6 transform -rotate-6 shadow-lg">
              <CreditCard className="w-10 h-10 text-white" />
            </div>
            
            <div className="space-y-2">
              <h2 className="text-3xl font-light tracking-tight">Premium Access</h2>
              <p className="text-sm opacity-50">Unlock the full AI Experience</p>
            </div>

            <div className="bg-[#F8F7F5] rounded-3xl p-8 border border-black/5">
              <div className="text-6xl font-light tracking-tighter mb-1">₹49</div>
              <div className="text-[10px] uppercase tracking-[0.3em] opacity-40">One-time Access</div>
            </div>

            <div className="space-y-4 pt-4">
              <div className="flex items-center gap-3 text-sm opacity-60">
                <div className="w-5 h-5 rounded-full bg-green-50 flex items-center justify-center">
                  <Check className="w-3 h-3 text-green-600" />
                </div>
                <span>Unlimited AI Try-ons</span>
              </div>
              <div className="flex items-center gap-3 text-sm opacity-60">
                <div className="w-5 h-5 rounded-full bg-green-50 flex items-center justify-center">
                  <Check className="w-3 h-3 text-green-600" />
                </div>
                <span>High-Definition Results</span>
              </div>
            </div>

            <button 
              onClick={() => setHasPaid(true)}
              className="w-full py-5 bg-black text-white rounded-2xl font-medium tracking-tight hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl flex items-center justify-center gap-3 group"
            >
              Unlock Now
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>

            <p className="text-[10px] opacity-30 mt-4">
              Securely processed via Razorpay. All results collected for quality.
            </p>
          </motion.div>
        </main>
      ) : (
        <main className="relative z-10 max-w-4xl mx-auto p-4 sm:p-8 min-h-[calc(100vh-80px)] flex flex-col justify-center">
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div 
              key="step0"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-12 text-center"
            >
              <div>
                <h2 className="text-4xl sm:text-6xl font-light mb-4 tracking-tight">What are we fitting?</h2>
                <p className="text-[#1A1A1A]/50 max-w-md mx-auto">Select the garment category to begin your virtual tailoring experience.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
                <CategoryCard 
                  title="Top" 
                  description="Shirts, blouses, coats, and sweaters." 
                  icon={<Shirt className="w-8 h-8" />}
                  selected={category === Category.TOP}
                  onClick={() => { setCategory(Category.TOP); nextStep(); }}
                  id="cat-top"
                />
                <CategoryCard 
                  title="Lower" 
                  description="Pants, skirts, shorts, and jeans." 
                  icon={<Pyramid className="w-8 h-8" />}
                  selected={category === Category.BOTTOM}
                  onClick={() => { setCategory(Category.BOTTOM); nextStep(); }}
                  id="cat-bottom"
                />
              </div>
            </motion.div>
          )}

          {(step === 1 || step === 2) && (
            <motion.div 
              key={`step${step}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="text-center sm:text-left">
                <span className="text-[10px] uppercase tracking-widest text-[#1A1A1A]/40 mb-2 block">Step {step} of 5</span>
                <h2 className="text-3xl sm:text-4xl font-light tracking-tight">
                  {step === 1 ? "Your Silhouette" : "The Garment"}
                </h2>
                <p className="text-[#1A1A1A]/50 mt-2">
                  {step === 1 
                    ? "Upload a clear, full-body photo of yourself facing forward." 
                    : "Upload a high-quality image of the flat-laid or studio-shot garment."}
                </p>
              </div>

              <div className="max-w-xl mx-auto">
                <ImageUploader 
                  image={step === 1 ? bodyImage : garmentImage}
                  setImage={step === 1 ? setBodyImage : setGarmentImage}
                  icon={step === 1 ? <PersonStanding className="w-12 h-12" /> : <Scissors className="w-12 h-12" />}
                  id={step === 1 ? "body-upload" : "garment-upload"}
                />
              </div>

              <div className="flex justify-between items-center max-w-xl mx-auto">
                <button onClick={prevStep} className="flex items-center gap-2 px-6 py-3 border border-black/10 rounded-full hover:bg-black/5 transition-colors">
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button 
                  disabled={!(step === 1 ? bodyImage : garmentImage)}
                  onClick={nextStep} 
                  className={`flex items-center gap-2 px-8 py-3 bg-[#1A1A1A] text-white rounded-full transition-all ${(!(step === 1 ? bodyImage : garmentImage)) ? 'opacity-30 cursor-not-allowed' : 'hover:scale-105 active:scale-95'}`}
                >
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {(step === 3 || step === 4) && (
            <motion.div 
              key={`step${step}`}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="space-y-8"
            >
              <div className="text-center sm:text-left flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                  <span className="text-[10px] uppercase tracking-widest text-[#1A1A1A]/40 mb-2 block">Precise Fitting</span>
                  <h2 className="text-3xl sm:text-4xl font-light tracking-tight">
                    {step === 3 ? "Body Measurements" : "Garment Dimensions"}
                  </h2>
                  <p className="text-[#1A1A1A]/50 mt-2">All values should be in inches for the best fit.</p>
                </div>
                
                <div className="flex gap-2">
                  {bodyImage && (
                    <button 
                      onClick={() => setStep(1)} 
                      className="group relative w-12 h-12 rounded-lg overflow-hidden border border-black/5 hover:border-black/20 transition-all"
                      title="Change Silhouette"
                    >
                      <img src={bodyImage} className="w-full h-full object-cover opacity-50 group-hover:opacity-100" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100">
                        <Upload className="w-3 h-3 text-white" />
                      </div>
                    </button>
                  )}
                  {garmentImage && (
                    <button 
                      onClick={() => setStep(2)} 
                      className="group relative w-12 h-12 rounded-lg overflow-hidden border border-black/5 hover:border-black/20 transition-all"
                      title="Change Garment"
                    >
                      <img src={garmentImage} className="w-full h-full object-cover opacity-50 group-hover:opacity-100" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100">
                        <Upload className="w-3 h-3 text-white" />
                      </div>
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-xl mx-auto bg-white p-8 rounded-3xl shadow-sm border border-black/5">
                {step === 3 ? (
                  <>
                    <InputGroup label="Height (Centimeters)" id="body-height">
                      <input 
                        type="number" 
                        value={bodyStats.height} 
                        placeholder="e.g. 165"
                        onChange={(e) => setBodyStats({...bodyStats, height: parseFloat(e.target.value)})}
                        className="w-full bg-transparent border-b border-black/10 py-2 focus:border-black outline-none transition-colors"
                      />
                    </InputGroup>
                    {category === Category.TOP ? (
                      <>
                        <InputGroup label="Bust (Inches)" id="body-bust">
                          <input 
                            type="number" 
                            placeholder="e.g. 34"
                            onChange={(e) => setBodyStats({...bodyStats, bust: parseFloat(e.target.value)})}
                            className="w-full bg-transparent border-b border-black/10 py-2 focus:border-black outline-none transition-colors"
                          />
                        </InputGroup>
                        <InputGroup label="Upper Waist (Inches)" id="body-upper-waist">
                          <input 
                            type="number" 
                            placeholder="e.g. 26"
                            onChange={(e) => setBodyStats({...bodyStats, upperWaist: parseFloat(e.target.value)})}
                            className="w-full bg-transparent border-b border-black/10 py-2 focus:border-black outline-none transition-colors"
                          />
                        </InputGroup>
                      </>
                    ) : (
                      <>
                        <InputGroup label="Mid Waist (Inches)" id="body-mid-waist">
                          <input 
                            type="number" 
                            placeholder="e.g. 28"
                            onChange={(e) => setBodyStats({...bodyStats, midWaist: parseFloat(e.target.value)})}
                            className="w-full bg-transparent border-b border-black/10 py-2 focus:border-black outline-none transition-colors"
                          />
                        </InputGroup>
                        <InputGroup label="Hip (Inches)" id="body-hip">
                          <input 
                            type="number" 
                            placeholder="e.g. 36"
                            onChange={(e) => setBodyStats({...bodyStats, hip: parseFloat(e.target.value)})}
                            className="w-full bg-transparent border-b border-black/10 py-2 focus:border-black outline-none transition-colors"
                          />
                        </InputGroup>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {category === Category.TOP ? (
                      <>
                        <InputGroup label="Garment Bust (Inches)" id="garment-bust">
                          <input 
                            type="number" 
                            placeholder="e.g. 36"
                            onChange={(e) => setGarmentStats({...garmentStats, bust: parseFloat(e.target.value)})}
                            className="w-full bg-transparent border-b border-black/10 py-2 focus:border-black outline-none transition-colors"
                          />
                        </InputGroup>
                        <InputGroup label="Garment Waist (Inches)" id="garment-waist">
                          <input 
                            type="number" 
                            placeholder="e.g. 28"
                            onChange={(e) => setGarmentStats({...garmentStats, waist: parseFloat(e.target.value)})}
                            className="w-full bg-transparent border-b border-black/10 py-2 focus:border-black outline-none transition-colors"
                          />
                        </InputGroup>
                      </>
                    ) : (
                      <>
                        <InputGroup label="Garment Waist (Inches)" id="garment-waist">
                          <input 
                            type="number" 
                            placeholder="e.g. 29"
                            onChange={(e) => setGarmentStats({...garmentStats, waist: parseFloat(e.target.value)})}
                            className="w-full bg-transparent border-b border-black/10 py-2 focus:border-black outline-none transition-colors"
                          />
                        </InputGroup>
                        <InputGroup label="Garment Hip (Inches)" id="garment-hip">
                          <input 
                            type="number" 
                            placeholder="e.g. 38"
                            onChange={(e) => setGarmentStats({...garmentStats, hip: parseFloat(e.target.value)})}
                            className="w-full bg-transparent border-b border-black/10 py-2 focus:border-black outline-none transition-colors"
                          />
                        </InputGroup>
                      </>
                    )}
                  </>
                )}
              </div>

              <div className="flex justify-between items-center max-w-xl mx-auto">
                <button onClick={prevStep} className="flex items-center gap-2 px-6 py-3 border border-black/10 rounded-full hover:bg-black/5 transition-colors">
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button 
                  onClick={step === 4 ? handleGenerate : nextStep} 
                  className="flex items-center gap-2 px-8 py-3 bg-[#1A1A1A] text-white rounded-full hover:scale-105 active:scale-95 transition-all shadow-lg shadow-black/10"
                >
                  {step === 4 ? "Enter Mirror" : "Continue"} <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {step === 5 && (
            <motion.div 
              key="step5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-8 flex flex-col items-center"
            >
              <div className="text-center">
                <h2 className="text-3xl sm:text-5xl font-light tracking-tight mb-2">The Reflection</h2>
                <p className="text-[#1A1A1A]/50">AI is fitting your garment using your precise measurements.</p>
              </div>

              <div className="relative w-full max-w-md aspect-[3/4] bg-white rounded-3xl overflow-hidden shadow-2xl border border-black/5 group">
                {isGenerating ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center space-y-4">
                    <div className="w-12 h-12 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                    <p className="text-xs uppercase tracking-widest opacity-40 animate-pulse">Processing Silhouette...</p>
                  </div>
                ) : resultImage ? (
                  <img src={resultImage} alt="Virtual Try On Result" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : error ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center space-y-4">
                     <Info className="w-12 h-12 text-red-500 opacity-60" />
                     <p className="text-sm text-red-800">{error}</p>
                     <button onClick={handleGenerate} className="text-xs uppercase tracking-widest font-bold underline">Try Again</button>
                  </div>
                ) : null}
              </div>

              {resultImage && !isGenerating && (
                <div className="flex flex-col sm:flex-row gap-4">
                   <button onClick={() => setStep(0)} className="px-8 py-3 border border-black/10 rounded-full hover:bg-black/5 transition-colors">Start New Fit</button>
                   <button className="px-8 py-3 bg-[#1A1A1A] text-white rounded-full hover:scale-105 transition-transform shadow-lg shadow-black/10">Save Reflection</button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      )}

      <footer className="relative z-10 p-8 border-t border-[#1A1A1A]/5 text-center sm:text-left">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 opacity-30 text-[10px] uppercase tracking-[0.2em]">
          <div>© 2026 Tryon-Mirror Labs</div>
          <div className="flex gap-8">
            <button onClick={() => setShowAdmin(true)} className="hover:opacity-100 transition-opacity cursor-pointer">View Collected Data</button>
            <a href="#" className="hover:opacity-100 transition-opacity">Privacy</a>
            <a href="#" className="hover:opacity-100 transition-opacity">Technology</a>
            <a href="#" className="hover:opacity-100 transition-opacity">Contact</a>
          </div>
        </div>
      </footer>

      {showAdmin && (
        <div className="fixed inset-0 z-[100] bg-white overflow-y-auto p-8">
          <div className="max-w-6xl mx-auto">
            <div className="flex justify-between items-center mb-12">
              <h2 className="text-4xl font-light tracking-tight">Collected Submissions</h2>
              <button 
                onClick={() => setShowAdmin(false)}
                className="p-3 bg-black text-white rounded-full hover:scale-110 transition-transform"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="grid gap-8">
              {submissions.length === 0 ? (
                <div className="text-center py-20 opacity-30 italic">No submissions collected yet.</div>
              ) : (
                submissions.map((sub: any) => (
                  <div key={sub.id} className="bg-white border border-black/5 rounded-3xl p-6 shadow-sm flex flex-col md:flex-row gap-8">
                    <div className="grid grid-cols-3 gap-2 w-full md:w-64">
                      {sub.body_image_path && (
                        <div className="space-y-1">
                          <p className="text-[8px] uppercase tracking-widest opacity-40">Silhouette</p>
                          <img src={sub.body_image_path} className="w-full aspect-[3/4] object-cover rounded-lg" />
                        </div>
                      )}
                      {sub.garment_image_path && (
                        <div className="space-y-1">
                          <p className="text-[8px] uppercase tracking-widest opacity-40">Garment</p>
                          <img src={sub.garment_image_path} className="w-full aspect-[3/4] object-cover rounded-lg" />
                        </div>
                      )}
                      {sub.result_image_path && (
                        <div className="space-y-1">
                          <p className="text-[8px] uppercase tracking-widest opacity-40">Result</p>
                          <img src={sub.result_image_path} className="w-full aspect-[3/4] object-cover rounded-lg" />
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-1 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-[10px] uppercase tracking-widest bg-black text-white px-2 py-0.5 rounded mr-2">#{sub.id}</span>
                          <span className="text-[10px] uppercase tracking-widest opacity-40">{new Date(sub.timestamp).toLocaleString()}</span>
                        </div>
                        <span className="text-sm font-medium capitalize">{sub.category}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <p className="text-[10px] uppercase tracking-widest opacity-40 font-bold">Body Stats</p>
                          <p className="text-xs font-mono">{sub.body_stats}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] uppercase tracking-widest opacity-40 font-bold">Garment Stats</p>
                          <p className="text-xs font-mono">{sub.garment_stats}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Subcomponents ---

function CategoryCard({ title, description, icon, selected, onClick, id }: { 
  title: string, description: string, icon: ReactNode, selected: boolean, onClick: () => void, id: string 
}) {
  return (
    <button 
      id={id}
      onClick={onClick}
      className={`p-8 text-left rounded-3xl border transition-all duration-500 group ${selected ? 'border-black bg-white shadow-xl scale-105' : 'border-black/5 bg-white/50 hover:bg-white hover:border-black/20'}`}
    >
      <div className={`mb-6 p-4 rounded-2xl w-fit transition-colors ${selected ? 'bg-black text-white shadow-lg' : 'bg-black/5 text-black group-hover:bg-black/10'}`}>
        {icon}
      </div>
      <h3 className="text-xl font-medium mb-1">{title}</h3>
      <p className="text-sm opacity-50">{description}</p>
    </button>
  );
}

function ImageUploader({ image, setImage, icon, id }: { 
  image: string | null, 
  setImage: (s: string | null) => void, 
  icon: ReactNode, 
  id: string
}) {
  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setImage(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  return (
    <div id={id} className="relative aspect-[4/3] sm:aspect-video rounded-3xl border-2 border-dashed border-black/10 bg-white/50 flex flex-col items-center justify-center p-6 group transition-colors hover:border-black/30 overflow-hidden">
      {image ? (
        <>
          <img src={image} className="absolute inset-0 w-full h-full object-contain p-4" alt="Uploaded Preview" referrerPolicy="no-referrer" />
          <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={() => setImage(null)}
              className="p-2 bg-white/90 backdrop-blur-sm text-red-500 rounded-full shadow-lg hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <label className="cursor-pointer bg-white text-black px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest shadow-xl flex items-center gap-2">
              <RotateCcw className="w-3 h-3" /> Replace Photo
            </label>
            <input type="file" className="hidden" accept="image/*" onChange={handleFile} />
          </div>
        </>
      ) : (
        <label className="cursor-pointer flex flex-col items-center gap-4 text-center">
          <div className="p-6 rounded-full bg-black/5 text-[#1A1A1A]/40 group-hover:bg-black/10 group-hover:scale-110 transition-all">
            {icon}
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Click to upload image</p>
            <p className="text-[10px] uppercase tracking-widest opacity-40">PNG, JPG, HEIC up to 10MB</p>
          </div>
          <input type="file" className="hidden" accept="image/*" onChange={handleFile} />
        </label>
      )}
    </div>
  );
}

function InputGroup({ label, children, id }: { label: string, children: ReactNode, id: string }) {
  return (
    <div className="space-y-2" id={id}>
      <label className="text-[10px] uppercase tracking-widest text-black/40 font-bold">{label}</label>
      {children}
    </div>
  );
}
