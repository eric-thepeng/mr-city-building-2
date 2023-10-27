using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using TMPro;

public class ScoringIdentifier : MonoBehaviour
{
    [SerializeField] private GameObject uiGameObject;
    [SerializeField] private TMP_Text uiTxt;
    [SerializeField] private SO_BuildingIdentifier myBI;

    public int CalculateScoring()
    {
        int scoreSum = 0;
        foreach (ScoringIdentifier si in FindObjectsOfType<ScoringIdentifier>())
        {
            if(si == this) continue;
            if ((si.gameObject.transform.position - gameObject.transform.position).magnitude <= myBI.detectDistance)
            {
                int thisScore = GetScoreFrom(myBI, si.GetBI());
                scoreSum += thisScore;
                si.UIDisplay(thisScore);
            }
            else
            {
                si.UICancelDisplay();
            }
        }

        UIDisplay(scoreSum);
        return scoreSum;
    }

    public SO_BuildingIdentifier GetBI()
    {
        return myBI;
    }

    public int GetScoreFrom(SO_BuildingIdentifier origionBI, SO_BuildingIdentifier targetBI)
    {
        if (targetBI.scoringScheme.ContainsKey(origionBI)) return targetBI.scoringScheme[origionBI];
        return 0;
    }

    public void CancelAllUIDisplay()
    {
        foreach (ScoringIdentifier si in FindObjectsOfType<ScoringIdentifier>())
        {
            si.UICancelDisplay();
        }
    }

    public void UICancelDisplay()
    {
        uiGameObject.SetActive(false);
    }

    public void UIDisplay(int score)
    {
        if (score == 0)
        {
            UICancelDisplay();
            return;
        }
        uiGameObject.SetActive(true);
        uiTxt.text = score > 0 ? "+" : "-";
        uiTxt.text += score;
    }
}
