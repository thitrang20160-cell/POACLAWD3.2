import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

// Helper to extract potential Walmart Order IDs and Tracking Numbers
const extractKeyEntities = (text: string) => {
  // Walmart Order ID patterns: often 13+ digits, sometimes with dashes
  const orderIdRegex = /\b\d{13,19}\b|\b\d{3}-\d{7}-\d{7}\b/g;
  const trackingRegex = /\b(1Z[0-9A-Z]{16}|9\d{21}|TBA\d{12})\b/g; // UPS, USPS, Amazon Logistics common patterns
  
  const orderIds = [...new Set(text.match(orderIdRegex) || [])].slice(0, 5); // Take top 5 unique
  const trackings = [...new Set(text.match(trackingRegex) || [])].slice(0, 5);
  
  return { orderIds, trackings };
};

export const parseFile = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        if (!data) {
          reject("Empty file");
          return;
        }

        const fileName = file.name.toLowerCase();
        let rawText = "";

        // Handle Excel Files
        if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv')) {
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
          
          rawText = JSON.stringify(jsonData.slice(0, 100)); // Increased limit to 100 rows
        } 
        // Handle Word Documents (.docx)
        else if (fileName.endsWith('.docx')) {
           try {
             const result = await mammoth.extractRawText({ arrayBuffer: data as ArrayBuffer });
             rawText = result.value;
           } catch (docxErr) {
             reject("DOCX parsing failed: " + docxErr);
             return;
           }
        }
        // Handle Text Files
        else {
          const textDecoder = new TextDecoder("utf-8");
          rawText = textDecoder.decode(data as ArrayBuffer);
        }

        // --- INTELLIGENT SUMMARY INJECTION ---
        const { orderIds, trackings } = extractKeyEntities(rawText);
        let intelligentHeader = `[FILE METADATA: ${file.name}]\n`;
        
        if (orderIds.length > 0) {
          intelligentHeader += `[DETECTED ORDER IDs]: ${orderIds.join(', ')}\n`;
        } else {
          intelligentHeader += `[DETECTED ORDER IDs]: None found (Please use placeholders)\n`;
        }

        if (trackings.length > 0) {
           intelligentHeader += `[DETECTED TRACKING #]: ${trackings.join(', ')}\n`;
        }

        resolve(intelligentHeader + "\n[RAW CONTENT START]\n" + rawText + "\n[RAW CONTENT END]");

      } catch (err) {
        reject("Failed to parse file: " + err);
      }
    };

    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
};